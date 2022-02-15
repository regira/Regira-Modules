export const naturalCompare = (as, bs, f) => {
    // https://stackoverflow.com/questions/4373018/sort-array-of-numeric-alphabetical-elements-natural-sort#answer-4373037
    let a, b, a1, b1, i = 0, rx = /(\d+)|(\D+)/g, rd = /\d/;
    if (isFinite(f(as)) && isFinite(f(bs))) {
        return f(as) - f(bs);
    }
    a = String(f(as)).toLowerCase();
    b = String(f(bs)).toLowerCase();
    if (a === b) {
        return 0;
    }
    if (!(rd.test(a) && rd.test(b))) {
        return a > b ? 1 : -1;
    }
    a = a.match(rx);
    b = b.match(rx);
    const length = a.length > b.length ? b.length : a.length;
    while (i < length) {
        a1 = a[i];
        b1 = b[i++];
        if (a1 !== b1) {
            if (isFinite(a1) && isFinite(b1)) {
                if (a1.charAt(0) === "0")
                    a1 = "." + a1;
                if (b1.charAt(0) === "0")
                    b1 = "." + b1;
                return a1 - b1;
            } else {
                return a1 > b1 ? 1 : -1;
            }
        }
    }
    return a.length - b.length;
};
export const getRandom = (min = 0, max = min) => {
    if (max === min) {
        min = 0;
    }
    if (max <= min) {
        if (min === 0) {
            return 0;
        }
        const errorMessage = 'Invalid input (max should be greater than min)';
        console.error(errorMessage, { min, max });
        throw Error(errorMessage);
    }
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// utility
export default {
    naturalCompare,
    getRandom
};