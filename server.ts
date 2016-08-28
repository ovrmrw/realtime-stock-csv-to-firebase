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
firebase.database().ref('lastUpdate').on('child_added', (snapshot: firebase.database.DataSnapshot) => {
  console.log(snapshot.val());
});


const isProductionMode = process.env.PRODUCTION || false; // 本番稼働時はtrueにすること 
if (isProductionMode) {
  console.log("=============  PRODUCTION MODE  =============");
} else {
  console.log("-------------  TEST MODE  -------------");
}


chokidar.watch(CSV_STORE_DIR, { ignored: /[\/\\]\./ }).on('all', (event: string, filePath: string) => {
  if (event === 'add' || event === 'change') {
    if (new RegExp(/\.(csv|txt)$/).test(filePath)) {
      console.log(event, filePath);

      fs.readFile(filePath, 'utf8', (err, data: string) => {
        if (err) { throw err; }
        console.log(data);

        parse(data, { columns: true, auto_parse: true }, (err, results: Array<ObjectFromCsv>) => {
          if (err) { throw err; }
          const now = moment().valueOf();
          let newResults = results
            .filter(result => !!result['銘柄コード'] && !!result['現在値'] && !!result['出来高']) // 最低限のValidation
            .map(result => Object.assign({
              'code': ('' + result['銘柄コード']).replace(/\./g, ':'),
              'date': '' + result['現在日付'],
              'updated': '' + result['現在日付'] + result['現在値詳細時刻'],
              'timestamp': now,
            }, result))
            .map(result => {
              ['コメント', '銘柄コード', '市場コード', '銘柄名称', '現在日付'].forEach(key => {
                delete result[key];
              });
              return result;
            })
            .map(result => { // プロパティ値が文字列で'null'の場合はnull値で置換する。
              Object.keys(result).map(key => {
                if (result[key] === 'null') {
                  result[key] = null;
                }
              });
              return result;
            });


          // Firebaseに書き込む          
          newResults.forEach((stock, i) => {
            const updated: number = moment(stock.updated, "YYYYMMDDHH:mm:ss").valueOf();
            const diffMinutes: number = Math.abs((now - updated) / 1000 / 60); // nowとupdatedの差が何分あるか求める。
            console.log('diffMinutes: ' + diffMinutes + 'm');
            delete stock.updated;

            if ( // 現在時刻との差が10分未満ならWrite対象
              (!stock.code.includes(':') && isInStockMarketHours() && diffMinutes < 10) || // 株式
              (stock.code.includes(':') && isInFutureMarketHours() && diffMinutes < 10) || // 指数先物
              !isProductionMode // Test Mode
            ) {
              console.time(`firebase write ${stock.code} ${i}`);
              const stockCategory = isProductionMode ? 'stocks' : 'stocks:test';
              const stockTreePath = stockCategory + '/' + stock.code + '/' + stock.date + '/' + stock.timestamp;

              // Firebaseに株価データをWriteする。
              firebase.database().ref(stockTreePath).set(stock, (err) => {
                if (err) { console.error(err); }
                console.log(stockTreePath);
                console.log(stock);
                console.timeEnd(`firebase write ${stock.code} ${i}`);

                // CSVファイルを削除する。
                if (i === newResults.length - 1) {
                  fs.unlink(filePath, (err) => {
                    if (err) { throw err; }
                  });

                  // FirebaseのlastUpdateを更新する。
                  firebase.database().ref('lastUpdate').set({
                    serial: now,
                    datetime: moment(now).format()
                  }, (err) => {
                    if (err) { console.error(err); }
                  });
                }
              });

              // 日足データをFirebaseに書き込む。
              let stockSummary = {};
              const summaryKeys = ['code', 'date', 'timestamp', '現在値', '現在値詳細時刻', '現在値フラグ', '出来高', '始値', '高値', '安値'];
              Object.keys(stock).map(key => {
                if (summaryKeys.includes(key)) {
                  // if (key === '現在値') {
                  //   stockSummary['終値'] = stock[key];
                  // } else {
                  //   stockSummary[key] = stock[key];
                  // }
                  stockSummary[key] = stock[key];
                }
              });
              const stockSummaryCategory = isProductionMode ? 'stocks:summary' : 'stocks:summary:test';
              const stockSummaryTreePath = stockSummaryCategory + '/' + stock.code + '/' + stock.date;
              firebase.database().ref(stockSummaryTreePath).set(stockSummary, (err) => {
                if (err) { console.error(err); }
                console.log(stockSummaryTreePath);
                console.log(stockSummary);
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