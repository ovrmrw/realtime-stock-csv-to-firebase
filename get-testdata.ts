import 'babel-polyfill';
import fs from 'fs'; // @types/node
import path from 'path' // @types/node
import lodash from 'lodash';
import firebase from 'firebase';


const config = require(path.join(path.resolve(), '.config.json'));

const firebaseConfig = {
  databaseURL: config.firebase.databaseURL,
  serviceAccount: '.keyfile.json'
};
firebase.initializeApp(firebaseConfig);


// // Firebaseからremoveしたいもの。
// const removeRefPaths = [
//   'stocks:index:test',
//   'stocks:summary:test',
//   'stocks:test'
// ];

// removeRefPaths.forEach(refPath => {
//   firebase.database().ref(refPath).remove(err => {
//     if (err) {
//       console.error(err);
//     } else {
//       console.log(refPath + ' is removed from Firebase.');
//     }
//   });
// });


firebase.database().ref('stocks:index:test/codes').orderByKey().on('value', (snapshot: firebase.database.DataSnapshot) => {
  console.log(snapshot.val());
  console.log(Object.keys(snapshot.val())); // ['1234','2345',...]
  console.log(Object.keys(snapshot.val()).length);
});

firebase.database().ref('stocks:index:test/N225:FUT01/dates').orderByKey().on('value', (snapshot: firebase.database.DataSnapshot) => {
  console.log(snapshot.val());
  console.log(Object.keys(snapshot.val())); // ['20160829','20160830',...]
  console.log(Object.keys(snapshot.val()).length);
});

firebase.database().ref('stocks:index:test/N225:FUT01/20160829').orderByKey().on('value', (snapshot: firebase.database.DataSnapshot) => {
  console.log(snapshot.val());
  console.log(Object.keys(snapshot.val())); // ['1472479518289','1472479520107',...]
  console.log(Object.keys(snapshot.val()).length);
});