import 'babel-polyfill';
import chokidar from 'chokidar'; // @types/chokidar
import parse from 'csv-parse'; // @types/csv-parse
import fs from 'fs'; // @types/node
import path from 'path' // @types/node
import moment from 'moment';
import lodash from 'lodash' // @types/lodash
import firebase from 'firebase';
import { createCsvStoreDirectory } from './create-directory';

const JP_TIME_OFFSET = 540
const config = require(path.join(path.resolve(), '.config.json'));

const CSV_STORE_DIR = path.join(...config.csvStoreDir as string[]);
createCsvStoreDirectory(CSV_STORE_DIR);
console.log('Observing ' + CSV_STORE_DIR + ' directory ...');

const firebaseConfig = {
  databaseURL: config.firebase.databaseURL,
  serviceAccount: '.keyfile.json'
};
firebase.initializeApp(firebaseConfig);

// Firebaseとのコネクションを前以って張っておく。こうすることで初回Write時に余計なWaitが発生しない。
firebase.database().ref('lastUpdate').on('value', (snapshot: firebase.database.DataSnapshot) => {
  const val = snapshot.val() as { serial: number };
  if (val.serial) {
    console.log('lastUpdate:', val, moment(val.serial).utcOffset(JP_TIME_OFFSET).format());
  }
  firebase.database().ref('lastUpdate').off();
});


const isProductionMode = process.env.PRODUCTION || false; // 本番稼働時はtrueにすること 
if (isProductionMode) {
  console.log("=============  PRODUCTION MODE  =============");
} else {
  console.log("-------------  TEST MODE  -------------");
}


let cachedStocks = {};
let cachedSummaries = {} as { [code: string]: Summary };
let cachedWalkings = {} as { [code: string]: Walking };


chokidar.watch(CSV_STORE_DIR, { ignored: /[\/\\]\./ }).on('all', (event: string, filePath: string) => {
  if (event === 'add' || event === 'change') {
    if (new RegExp(/\.(csv|txt)$/).test(filePath)) {
      console.log('='.repeat(90));
      console.log(event, filePath);


      fs.readFile(filePath, 'utf8', (err, data: string) => {
        if (err) { console.error(err); }

        // CSVファイルの作成時刻(または更新時刻)を取得する。ファイルがRamDisk上にあると値がおかしくなるので注意。
        let timestamp: number;
        if (filePath.split('__').length > 1) {
          timestamp = +filePath.split('__')[1]; // TODO: Validationする
        } else {
          console.error('SKIPPED: filePath( ' + filePath + ' ) should contain the string as "__{UnixTimestamp}__"');
          return;
        }
        console.log('timestamp:', timestamp, moment(timestamp).utcOffset(JP_TIME_OFFSET).format()); // 日本時間に変換した時刻が表示される。

        // CSVファイルを削除する。
        fs.unlink(filePath, (err) => {
          if (err) { console.error(err); }
        });


        // CSVファイルをパースしてJSオブジェクトの配列を取得する。
        parse(data, { columns: true, auto_parse: true }, (err, results: Array<ObjectFromCsv>) => {
          if (err) { console.error(err); }

          // resultsを加工する。
          const newResults = results
            // .filter(result => !!result['銘柄コード'] && !!result['現在値'] && !!result['出来高']) // 最低限のValidation
            .filter(result => result['銘柄コード'] && result['現在日付']) // 最低限のValidation
            .map(result => Object.assign(result, {
              'code': ('' + result['銘柄コード']).replace(/\./g, ':') as string,
              'date': '' + result['現在日付'] as string,
              // 'updated': '' + result['現在日付'] + ('' + result['現在値詳細時刻']).replace(/:/g, ''), // 現在値詳細時刻は文字列として受け取っておかないと'000301'は頭の0がカットされてしまう。
              // 'timestamp': timestamp, // timestamp
              '売買フラグ': null as (string | null),
            }))
            .map(result => { // 不要なプロパティを削除する。
              // ['コメント', '銘柄コード', '市場コード', '銘柄名称', '現在日付'].forEach(key => {
              ['コメント', '銘柄コード', '市場コード'].forEach(key => {
                delete result[key];
              });
              return result;
            })
            .map(result => { // プロパティ名に'詳細時刻'を含む場合、":"を除去する。
              Object.keys(result).map(key => {
                if (key.includes('詳細時刻')) {
                  result[key] = ('' + result[key]).replace(/:/g, '');
                }
              });
              return result;
            })
            .map(result => { // プロパティ値が文字列で'null'の場合はnull値で置換する。
              Object.keys(result).map(key => {
                if (result[key] === 'null' || result[key] === '') {
                  result[key] = null;
                }
              });
              return result;
            })
            .map(result => {
              if (result['現在値'] === result['最良売気配値１']) {
                result.売買フラグ = 'B'; // Buy
              } else if (result['現在値'] === result['最良買気配値１']) {
                result['売買フラグ'] = 'S'; // Sell
              } else {
                result['売買フラグ'] = ' ';
              }
              return result;
            });


          // Firebaseに書き込む          
          newResults.forEach((stock, i) => {
            const now: number = new Date().valueOf();
            const diffMinutes: number = Math.abs((now - timestamp) / 1000 / 60); // nowとtimestampの差が何分あるか求める。
            console.log(stock.code, 'diffMinutes: ' + diffMinutes + 'm');

            if ( // 現在時刻との差が10分未満ならWrite対象
              (!stock.code.includes(':') && isInStockMarketHours() && diffMinutes < 10) || // 株式
              (stock.code.includes(':') && isInFutureMarketHours() && diffMinutes < 10) || // 指数先物
              !isProductionMode // Test Mode
            ) {
              console.time(`firebase write ${filePath} ${stock.code}`);


              // Firebaseに株価データをWriteする。
              let uploadStock = {};
              if (cachedStocks[stock.code]) { // stockがcacheにある場合
                const cachedStock = cachedStocks[stock.code];
                Object.keys(stock).map(key => {
                  if ((cachedStock[key] && cachedStock[key] !== stock[key]) || (!cachedStock[key] && stock[key])) {
                    uploadStock[key] = stock[key];
                  }
                });
              } else { // stockがcacheにない場合
                uploadStock = Object.assign({}, stock);
              }
              if (uploadStock['現在値']) { // 現在値に変化があったときは歩みに関するデータを全て含める。
                [
                  '現在値ティック', '現在値詳細時刻',
                  '歩み１', '歩み２', '歩み３', '歩み４',
                  '歩み１詳細時刻', '歩み２詳細時刻', '歩み３詳細時刻', '歩み４詳細時刻'
                ].forEach(key => {
                  uploadStock[key] = stock[key];
                });
              }
              if (uploadStock['出来高']) { // 出来高に変化があったときは現在値に関するデータを全て含める。
                [
                  '現在値', '現在値ティック', '現在値詳細時刻',
                ].forEach(key => {
                  uploadStock[key] = stock[key];
                });
              }

              const stockCategory = isProductionMode ? 'stocks' : 'stocks:test';
              const stockTreePath = stockCategory + '/' + stock.code + '/' + stock.date + '/' + timestamp;
              firebase.database().ref(stockTreePath).set(uploadStock, (err) => {
                if (err) {
                  console.error(err);
                } else {
                  console.log('-'.repeat(80));
                  console.log(stockTreePath);
                  console.log(uploadStock);
                  console.timeEnd(`firebase write ${filePath} ${stock.code}`);
                  // cachedStocks[stock.code] = stock;

                  // FirebaseのlastUpdateを更新する。
                  if (i === newResults.length - 1) {
                    firebase.database().ref('lastUpdate').update({
                      serial: timestamp
                    }, (err) => {
                      if (err) { console.error(err); }
                    });
                  }
                }
              });
              cachedStocks[stock.code] = stock;


              // 日足データをFirebaseに書き込む。
              let stockSummary: Summary = {};
              const summaryKeys = ['code', 'date', '銘柄名称', '現在値', '現在値詳細時刻', '現在値ティック', '現在値フラグ', '出来高', '始値', '高値', '安値'];
              Object.keys(stock).map(key => {
                if (summaryKeys.includes(key)) {
                  stockSummary[key] = stock[key];
                }
              });
              let uploadSummary: Summary = {};
              if (cachedSummaries[stock.code]) { // summaryがcacheにある場合
                const cachedSummary = cachedSummaries[stock.code];
                Object.keys(stock).map(key => {
                  if ((cachedSummary[key] && cachedSummary[key] !== stockSummary[key]) || (!cachedSummary[key] && stockSummary[key])) {
                    uploadSummary[key] = stockSummary[key];
                  }
                });
              } else { // summaryがcacheにない場合
                uploadSummary = Object.assign({}, stockSummary);
              }
              if (Object.keys(uploadSummary).length) {
                const stockSummaryCategory = isProductionMode ? 'stocks:summary' : 'stocks:summary:test';
                const stockSummaryTreePath = stockSummaryCategory + '/' + stock.code + '/' + stock.date;
                firebase.database().ref(stockSummaryTreePath).update(uploadSummary, (err) => {
                  if (err) {
                    console.error(err);
                  } else {
                    console.log(stockSummaryTreePath);
                    console.log(uploadSummary);
                    // cachedSummaries[stock.code] = stockSummary;
                  }
                });
                cachedSummaries[stock.code] = stockSummary;
              }


              // 歩み値をFirebaseに書き込む。
              let stockWalking: Walking = {};
              const stockWalkingKeys = ['現在値', '現在値詳細時刻', '出来高', '売買フラグ'];
              Object.keys(stock).map(key => {
                if (stockWalkingKeys.includes(key)) {
                  if (key === '現在値') {
                    stockWalking.約定値 = +stock[key];
                  } else {
                    stockWalking[key] = stock[key];
                  }
                }
              });
              const cachedWalking = cachedWalkings[stock.code];
              if (cachedWalking && cachedWalking.出来高) { // cacheが存在する場合のみ歩み値の記録をする。
                stockWalking.出来高差分 = stockWalking.出来高 - cachedWalking.出来高;
                if (stockWalking.約定値 > cachedWalking.約定値) {
                  stockWalking.現在値ティック = '↑';
                } else if (stockWalking.約定値 < cachedWalking.約定値) {
                  stockWalking.現在値ティック = '↓';
                } else {
                  stockWalking.現在値ティック = ' ';
                }
                if (Object.keys(stockWalking).length && stockWalking.出来高差分 > 0) { // 出来高差分がある場合のみ記録する。
                  const stockWalkingCategory = isProductionMode ? 'stocks:walking' : 'stocks:walking:test';
                  const stockWalkingTreePath = stockWalkingCategory + '/' + stock.code + '/' + stock.date + '/' + timestamp;
                  delete stockWalking.出来高; // 出来高プロパティを削除する。
                  firebase.database().ref(stockWalkingTreePath).update(stockWalking, (err) => {
                    if (err) {
                      console.error(err);
                    } else {
                      console.log(stockWalkingTreePath);
                      console.log(stockWalking);
                      // cachedWalkings[stock.code] = stockWalking;
                    }
                  });
                  cachedWalkings[stock.code] = stockWalking;
                }
              } else {
                cachedWalkings[stock.code] = stockWalking;
              }


              // IndexをFirebaseに書き込む。後にこれらのキーだけを使う。
              const indexObj = { // Firebaseは何らかのオブジェクトを各RefPathにWriteしなければならない。
                i: 1
              };
              const stockIndexCategory = isProductionMode ? 'stocks:index' : 'stocks:index:test';
              const stockIndexRefPaths: string[] = [
                stockIndexCategory + '/' + stock.code + '/' + stock.date + '/' + timestamp,
                stockIndexCategory + '/' + stock.code + '/dates/' + stock.date,
                stockIndexCategory + '/codes/' + stock.code,
              ];
              const stockIndexTreeObj = stockIndexRefPaths.reduce((obj, refPath) => {
                obj[refPath] = indexObj;
                return obj;
              }, {});

              firebase.database().ref().update(stockIndexTreeObj, (err) => {
                if (err) {
                  console.error(err);
                } else {
                  console.log(stockIndexTreeObj);
                }
              });

            }

          });
        });
      });
    }
  }
});





function isInStockMarketHours(): boolean {
  const hoursMinutes: string = moment().utcOffset(JP_TIME_OFFSET).format("HHmm"); // 14時50分なら"1450"となる。
  if (hoursMinutes > "0855" && hoursMinutes < "1520") {
    return true;
  } else {
    console.log(hoursMinutes + '(HHmm) is not in stock market hours.');
    return false;
  }
}

function isInFutureMarketHours(): boolean {
  const hoursMinutes: string = moment().utcOffset(JP_TIME_OFFSET).format("HHmm"); // 14時50分なら"1450"となる。
  if ((hoursMinutes > "0840" && hoursMinutes < "1520") || (hoursMinutes > "1625" && hoursMinutes <= "2359") || ((hoursMinutes >= "0000" && hoursMinutes < "0535"))) {
    return true;
  } else {
    console.log(hoursMinutes + '(HHmm) is not in future market hours.');
    return false;
  }
}



interface ObjectFromCsv {
  [key: string]: string | number | null;
}

interface Summary {
  code?: string
  date?: string
  銘柄名称?: string
  現在値?: number
  現在値詳細時刻?: string
  現在値ティック?: string
  現在値フラグ?: string
  出来高?: number
  始値?: number
  高値?: number
  安値?: number
}

interface Walking {
  約定値?: number
  現在値詳細時刻?: string
  出来高?: number
  出来高差分?: number
  現在値ティック?: string
  売買フラグ?: string
}