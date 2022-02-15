import { debounceToPromise, enqueue } from '../utilities/promise-utility';

export default {
    use() {
        Promise.debounce = debounceToPromise;
        Promise.enqueue = enqueue;
    }
};