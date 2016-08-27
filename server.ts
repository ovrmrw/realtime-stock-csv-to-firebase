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
  console.log(snapshot.val());
});

let isTestMode = true; // 本番稼働時はfalseにすること
let forcedWriteFlag = false; // 本番稼働時はfalseにすること ←必要？ 


chokidar.watch(CSV_STORE_DIR, { ignored: /[\/\\]\./ }).on('all', (event: string, filePath: string) => {
  if (event === 'add' || event === 'change') {
    if (new RegExp(/\.(csv|txt)$/).test(filePath)) {
      console.log(event, filePath);

      fs.readFile(filePath, 'utf8', (err, data: string) => {
        if (err) { throw err; }
        console.log(data);

        parse(data, { columns: true, auto_parse: true }, (err, results: Array<ObjectFromCsv>) => {
          if (err) { throw err; }
          console.time('parse加工');
          const now = moment().valueOf();
          let newResults = results
            .filter(result => !!result['銘柄コード'] && !!result['現在値'] && !!result['出来高']) // 最低限のValidation
            .map(result => Object.assign({
              'code': '' + result['銘柄コード'],
              'date': '' + result['現在日付'],
              'updated': '' + result['現在日付'] + result['現在値詳細時刻'],
              'timestamp': now,
            }, result))
            .map(result => {
              ['コメント', '銘柄コード', '市場コード', '銘柄名称', '現在日付', '現在値詳細時刻'].forEach(key => {
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

          console.timeEnd('parse加工');

          // Firebaseに書き込む          
          newResults.forEach((stock, i) => {
            const updated: number = moment(stock.updated, "YYYYMMDDHHmmss").valueOf();
            const diffMinutes: number = Math.abs((now - updated) / 1000 / 60);
            delete stock.updated;
            if (diffMinutes < 10 || isTestMode || forcedWriteFlag) { // 現在時刻との差が10分未満ならWrite対象
              console.time('firebase write ' + i);
              const category = isTestMode ? 'stocks:test' : 'stocks';
              const treePath = category + '/' + stock.code + '/' + stock.date + '/' + stock.timestamp;

              // Firebaseに株価データをWriteする。
              firebase.database().ref(treePath).set(stock, (err) => {
                if (err) { console.error(err); }
                console.log(treePath);
                console.log(stock);
                console.timeEnd('firebase write ' + i);

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