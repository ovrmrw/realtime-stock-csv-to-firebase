# realtime-stock-csv-to-firebase
Realtime stock data writer from CSV (on local disk) to Firebase endlessly.

---

### Create JSON files

`.config.json`
```
{
  "csvStoreDir": ["C:", "chokidar"],
  "firebase": {
    "databaseURL": "https://xxxxxx.firebaseio.com"
  }
}
```

`.keyfile.json` from Firebase Console.

### Setup
```
$ npm install
```

### Run (after build)
```
$ npm run build
$ npm start
```

### Run (without build)
```
$ npm run ts
```
