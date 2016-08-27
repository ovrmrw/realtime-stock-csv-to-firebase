const moment = require('moment');

const now = moment().valueOf();

const updated = moment("20160827220000", "YYYYMMDDHHmmss").valueOf();

const diffMinutes = Math.abs((now - updated) / 1000 / 60)

console.log(diffMinutes);

