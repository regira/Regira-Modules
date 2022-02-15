/**
 * Debounces a function and returns a promise when invoked, all promises resolve to the final (invoked) value
 * 
 * @param {Function} func 
 *  The function to debounce
 * @param {number} wait 
 *  Maximum delay in Milliseconds before invoking
 * 
 * @returns {Promise} Returns the result of the invoked function, wrapped in a Promise
 */
export const debounceToPromise = (func, wait = 250) => {
    let timeout;
    let funcsToResolve = [];
    return async function () {
        // https://davidwalsh.name/javascript-debounce-function
        const args = [...arguments];
        clearTimeout(timeout);
        return new Promise(resolve => {
            funcsToResolve.push(resolve);
            timeout = setTimeout(() => {
                timeout = null;
                const result = func(...args);
                while (funcsToResolve.length) {
                    funcsToResolve.shift()(result);
                }
            }, wait);
        });
    };
};
/**
 * Executes a collection of async functions in order
 * @param {Array<Function>} array of (async) functions 
 */
export const enqueue = async (arr) => {
    let hasErrors = false;
    const results = await arr.reduce(async (r, p) => {
        const currentResult = await r;
        const newResult = await Promise.resolve(p()).catch(err => { hasErrors = true; return err; });
        currentResult.push(newResult);
        return currentResult;
    }, []);
    if (hasErrors) {
        return Promise.reject(results);
    }
    return results;
};


// utility object
export default {
    debounceToPromise,
    enqueue
};
