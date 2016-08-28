# realtime-stock-csv-to-firebase
Realtime stock data writer from CSV (on local disk) to Firebase endlessly.

---

### Create JSON files

**1.. ".config.json"**
```
{
  "csvStoreDir": ["C:", "chokidar"],
  "firebase": {
    "databaseURL": "https://{your-project-id}.firebaseio.com"
  }
}
```
In the above case, `C:\chokidar` directory is where CSV files will be created. 

**2.. ".keyfile.json" from Firebase Console.**

### Setup
```
$ npm install
```

### Run (js files after build)
```
$ npm start
```

### Run (ts files directly)
```
$ npm run ts
```
