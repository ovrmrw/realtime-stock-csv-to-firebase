import 'babel-polyfill';
import fs from 'fs'; // @types/node
import path from 'path' // @types/node
import firebase from 'firebase';

const config = require(path.join(path.resolve(), '.config.json'));

const firebaseConfig = {
  databaseURL: config.firebase.databaseURL,
  serviceAccount: '.keyfile.json'
};
firebase.initializeApp(firebaseConfig);


// Firebaseからremoveしたいもの。
const removeRefPaths = [
  'stocks:index:test',
  'stocks:summary:test',
  'stocks:test'
];

removeRefPaths.forEach(refPath => {
  firebase.database().ref(refPath).remove(err => {
    if (err) {
      console.error(err);
    } else {
      console.log(refPath + ' is removed from Firebase.');      
    }
    firebase.database().ref(refPath).off();
  });
});