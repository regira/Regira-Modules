import arrayExtensions from "./array-extensions";
import dateExtensions from "./date-extensions";
import promiseExtensions from "./promise-extensions";

export { default as arrayExtensions } from "./array-extensions";
export { default as dateExtensions } from "./date-extensions";
export { default as promiseExtensions } from "./promise-extensions";

export default {
    useArrayExtensions: arrayExtensions.use.bind(arrayExtensions),
    useDateExtensions: dateExtensions.use.bind(dateExtensions),
    usePromiseExtensions: promiseExtensions.use.bind(promiseExtensions)
};