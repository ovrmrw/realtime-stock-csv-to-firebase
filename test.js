let moment = require('moment');

const now = new Date().valueOf();

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


console.log(moment(now).format()) // 特に指定はしていないが自動的に日本時間に変換されている。キモい。
console.log(moment(now).utc().format()) // これはグリニッジ標準時？
console.log(moment(now).utc().add(9, 'h').format()) // 標準時に一度戻してから日本時間に変換している。


console.log(moment().utcOffset(540))
console.log(moment().utcOffset(540).format())