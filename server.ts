import 'babel-polyfill';
import chokidar from 'chokidar'; // @types/chokidar
import parse from 'csv-parse'; // @types/csv-parse
import fs from 'fs'; // @types/node
import path from 'path' // @types/node
import moment from 'moment';
import lodash from 'lodash' // @types/lodash
import firebase from 'firebase';

const config = require(path.join(path.resolve(), '.config.json'));

const CSV_STORE_DIR = path.join(...config.csvStoreDir as string[]);
console.log('Observing ' + CSV_STORE_DIR + ' directory ...');

const firebaseConfig = {
  databaseURL: config.firebase.databaseURL,
  serviceAccount: '.keyfile.json'
};
firebase.initializeApp(firebaseConfig);

// Firebaseとのコネクションを前以って張っておく。こうすることで初回Write時に余計なWaitが発生しない。
firebase.database().ref('lastUpdate').on('value', (snapshot: firebase.database.DataSnapshot) => {
  console.log('lastUpdate: ', snapshot.val());
  firebase.database().ref('lastUpdate').off();
});


const isProductionMode = process.env.PRODUCTION || false; // 本番稼働時はtrueにすること 
if (isProductionMode) {
  console.log("=============  PRODUCTION MODE  =============");
} else {
  console.log("-------------  TEST MODE  -------------");
}


let cachedStocks = {};
let cachedSummaries = {};


chokidar.watch(CSV_STORE_DIR, { ignored: /[\/\\]\./ }).on('all', (event: string, filePath: string) => {
  if (event === 'add' || event === 'change') {
    if (new RegExp(/\.(csv|txt)$/).test(filePath)) {
      console.log('='.repeat(90));
      console.log(event, filePath);

      fs.readFile(filePath, 'utf8', (err, data: string) => {
        if (err) { throw err; }
        // console.log(data);

        parse(data, { columns: true, auto_parse: true }, (err, results: Array<ObjectFromCsv>) => {
          if (err) { throw err; }

          // const now = moment().valueOf();
          const ctime: number = fs.statSync(filePath).ctime.getTime();

          const newResults = results
            .filter(result => !!result['銘柄コード'] && !!result['現在値'] && !!result['出来高']) // 最低限のValidation
            .map(result => Object.assign(result, {
              'code': ('' + result['銘柄コード']).replace(/\./g, ':'),
              'date': '' + result['現在日付'],
              // 'updated': '' + result['現在日付'] + ('' + result['現在値詳細時刻']).replace(/:/g, ''), // 現在値詳細時刻は文字列として受け取っておかないと'000301'は頭の0がカットされてしまう。
              'timestamp': ctime, // timestamp
            }))
            .map(result => {
              // ['コメント', '銘柄コード', '市場コード', '銘柄名称', '現在日付'].forEach(key => {
              ['コメント'].forEach(key => {
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
            });


          // Firebaseに書き込む          
          newResults.forEach((stock, i) => {
            const now: number = moment().valueOf();
            const diffMinutes: number = Math.abs((now - ctime) / 1000 / 60); // nowとctimeの差が何分あるか求める。
            console.log('diffMinutes: ' + diffMinutes + 'm');
            // delete stock.updated;

            if ( // 現在時刻との差が10分未満ならWrite対象
              (!stock.code.includes(':') && isInStockMarketHours() && diffMinutes < 10) || // 株式
              (stock.code.includes(':') && isInFutureMarketHours() && diffMinutes < 10) || // 指数先物
              !isProductionMode // Test Mode
            ) {
              console.log('-'.repeat(80));
              console.time(`firebase write ${stock.code} ${i}`);


              // Firebaseに株価データをWriteする。
              let uploadStock = {};
              if (cachedStocks[stock.code]) { // stockがcacheにある場合
                const cachedStock = cachedStocks[stock.code];
                Object.keys(stock).map(key => {
                  if ((cachedStock[key] && cachedStock[key] !== stock[key]) || (!cachedStock[key] && stock[key])) {
                    uploadStock[key] = stock[key];
                  }
                  // } else if (['code', 'date', 't'].includes(key)) { // 検索キーとなるものは必須。
                  //   uploadStock[key] = stock[key];
                  // }
                });
              } else { // stockがcacheにない場合
                uploadStock = Object.assign({}, stock);
              }
              if (uploadStock['出来高']) { // 出来高に変化があったときは現在値に関するデータを全て含める。
                [
                  '現在値', '現在値ティック', '現在値詳細時刻',
                  // '歩み１', '歩み２', '歩み３', '歩み４',
                  // '歩み１詳細時刻', '歩み２詳細時刻', '歩み３詳細時刻', '歩み４詳細時刻'
                ].forEach(key => {
                  uploadStock[key] = stock[key];
                });
              }
              delete uploadStock['timestamp'];

              // console.log(cachedStocks[stock.code]);
              // console.log(stock);
              // console.log(uploadStock);

              const stockCategory = isProductionMode ? 'stocks' : 'stocks:test';
              const stockTreePath = stockCategory + '/' + stock.code + '/' + stock.date + '/' + stock.timestamp;
              firebase.database().ref(stockTreePath).set(uploadStock, (err) => {
                if (err) {
                  console.error(err);
                } else {
                  console.log(stockTreePath);
                  console.log(uploadStock);
                  console.timeEnd(`firebase write ${stock.code} ${i}`);
                  cachedStocks[stock.code] = stock;

                  // CSVファイルを削除する。
                  if (i === newResults.length - 1) {
                    fs.unlink(filePath, (err) => {
                      if (err) { console.error(err); }
                    });

                    // FirebaseのlastUpdateを更新する。
                    firebase.database().ref('lastUpdate').update({
                      serial: ctime
                    }, (err) => {
                      if (err) { console.error(err); }
                    });
                  }
                }
              });


              // 日足データをFirebaseに書き込む。
              let stockSummary = {};
              const summaryKeys = ['code', 'date', '銘柄名称', '現在値', '現在値詳細時刻', '現在値ティック', '現在値フラグ', '出来高', '始値', '高値', '安値'];
              Object.keys(stock).map(key => {
                if (summaryKeys.includes(key)) {
                  stockSummary[key] = stock[key];
                }
              });
              let uploadSummary = {};
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
                    cachedSummaries[stock.code] = stockSummary;
                  }
                });
              }


              // IndexをFirebaseに書き込む。
              const indexObj = {
                i: 1
              };
              const stockIndexCategory = isProductionMode ? 'stocks:index' : 'stocks:index:test';
              const stockIndexTreePath = stockIndexCategory + '/' + stock.code + '/' + stock.date + '/' + stock.timestamp;
              firebase.database().ref(stockIndexTreePath).update(indexObj, (err) => {
                if (err) {
                  console.error(err);
                } else {
                  console.log(stockIndexTreePath, indexObj);
                }
              });

              // const stockIndexDate = {
              //   date: stock.date
              // };
              const stockIndexDateTreePath = stockIndexCategory + '/' + stock.code + '/dates/' + stock.date;
              firebase.database().ref(stockIndexDateTreePath).update(indexObj, (err) => {
                if (err) {
                  console.error(err);
                } else {
                  console.log(stockIndexDateTreePath, indexObj);
                }
              });

              // const stockIndexCode = {
              //   code: stock.code
              // };
              const stockIndexCodeTreePath = stockIndexCategory + '/codes/' + stock.code;
              firebase.database().ref(stockIndexCodeTreePath).update(indexObj, (err) => {
                if (err) {
                  console.error(err);
                } else {
                  console.log(stockIndexCodeTreePath, indexObj);
                }
              });

            }

          });
        });
      });
    }
  }
});


interface ObjectFromCsv {
  [key: string]: string | number | boolean | null;
}


function isInStockMarketHours(): boolean {
  const hoursMinutes: string = moment().format("HHmm"); // 14時50分なら"1450"となる。
  if (hoursMinutes > "0855" && hoursMinutes < "1520") {
    return true;
  } else {
    console.log(hoursMinutes + '(HHmm) is not in stock market hours.');
    return false;
  }
}

function isInFutureMarketHours(): boolean {
  const hoursMinutes: string = moment().format("HHmm"); // 14時50分なら"1450"となる。
  if ((hoursMinutes > "0840" && hoursMinutes < "1520") || (hoursMinutes > "1625" && hoursMinutes <= "2359") || ((hoursMinutes >= "0000" && hoursMinutes < "0535"))) {
    return true;
  } else {
    console.log(hoursMinutes + '(HHmm) is not in future market hours.');
    return false;
  }
}