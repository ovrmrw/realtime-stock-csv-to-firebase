const moment = require('moment');

const now = moment().valueOf();

const updated = moment("20160827220000", "YYYYMMDDHHmmss").valueOf();

const diffMinutes = Math.abs((now - updated) / 1000 / 60)

console.log(diffMinutes);

console.log(moment().hour());
console.log(moment().hours());

console.log(moment().format("HHmm"));

console.log("0850" < "1000");
console.log("1450" < "1530");

console.log('-'.repeat((80)));

// console.log(moment().valueOf());
// moment().locale('ja');
// console.log(moment().locale('ja').valueOf());

console.log(new Date().valueOf())
console.log(moment().valueOf())
console.log(new Date(new Date().valueOf()))

console.log(moment(new Date().valueOf()).format()) // 特に指定はしていないが自動的に日本時間に変換されている。
console.log(moment(new Date().valueOf()).format('YYYY-MM-DD hh:mm:ss a'))
console.log(moment(moment().valueOf()).format('YYYY-MM-DD hh:mm:ss a'))
