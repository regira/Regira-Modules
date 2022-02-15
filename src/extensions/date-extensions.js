import { stringifyDate } from '../utilities/datetime-utility';

export default {
    use() {
        Date.prototype.toJSON = function () {
            return stringifyDate(this);
        };
    }
};