import { filterObject } from "./object-utility";
import { naturalCompare, getRandom } from "./number-utility";

const selfSelector = (x) => x;
const compareAsc = (a, b, f) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
const compareDesc = (a, b, f) => (f(a) > f(b) ? -1 : f(a) < f(b) ? 1 : 0);

export const isArray = (items) => Array.isArray(items);
export const isIterable = (items) => items != null && typeof items[Symbol.iterator] === "function";
export const toArray = (items) => (!items ? [] : isArray(items) ? items : isIterable(items) ? [...items] : Object.values(items));
export const newArray = (length) => [...Array(length)];

export const orderBy = (items, selector = selfSelector) => {
  const arr = [...items];
  arr.sort((a, b) => compareAsc(a, b, selector));
  return arr;
};
export const orderByDesc = (items, selector = selfSelector) => {
  const arr = [...items];
  arr.sort((a, b) => compareDesc(a, b, selector));
  return arr;
};
export const naturalSort = (items, selector = selfSelector) => {
  const arr = [...items];
  arr.sort((a, b) => naturalCompare(a, b, selector));
  return arr;
};
export const shuffle = (items) => {
  const source = [...items]; // copy array
  return [...Array(source.length)].map(() => {
    const index = getRandom(source.length - 1);
    return source.splice(index, 1)[0];
  });
};
export const innerJoin = (items1, items2, selector1 = selfSelector, selector2 = selfSelector, resultSelector = selector1) => {
  const result = [];
  const arr1 = toArray(items1);
  const arr2 = toArray(items2);
  arr1.forEach((x) => {
    const joinedItems = arr2.filter((y) => selector1(x) === selector2(y));
    joinedItems.forEach((y) => {
      result.push(resultSelector(x, y));
    });
  });
  return result;
};
export const groupBy = (items, keySelector) => {
  // return [
  //   ...toMap(items, keySelector, (v, i, map) => {
  //     const key = keySelector(v);
  //     if (!map.has(key)) {
  //       return [v];
  //     }
  //     const currentValue = map.get(key);
  //     return currentValue.concat(v);
  //   }),
  // ];
  const keys = distinct(items.map(keySelector));
  return keys.map((key) => [key, items.filter((y, j, arr2) => key === keySelector(y, j, arr2))]);
};
export const groupJoin = (
  parentItems,
  childItems,
  parentKeySelector = selfSelector,
  childSelector = selfSelector,
  resultSelector = (parent, children) => [parent, children]
) => {
  const childArr = toArray(childItems);
  return toArray(parentItems)
    .map((x, i, parents) => [x, childArr.filter((y, j, children) => parentKeySelector(x, i, parents) === childSelector(y, j, children))])
    .map(([groupedKey, groupedValues]) => resultSelector(groupedKey, groupedValues));
};
export const except = (items1, items2, selector1 = selfSelector, selector2 = selfSelector) => {
  const arr2 = toArray(items2);
  return toArray(items1).filter((x) => !arr2.some((y) => selector1(x) === selector2(y)));
};
export const count = (items, predicate) => {
  const arr = toArray(items);
  return predicate ? arr.filter(predicate).length : arr.length;
};
export const first = (items, predicate) => {
  const arr = toArray(items);
  if (!predicate) {
    return arr[0];
  }
  return arr.find(predicate);
};
export const last = (items, predicate) => {
  const arr = toArray(items);
  if (!predicate) {
    return arr.length ? arr[arr.length - 1] : undefined;
  }
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) {
      return arr[i];
    }
  }
  return undefined;
};
export const distinctBy = (items, selector) => {
  const arr = toArray(items);
  return arr.reduce((r, v) => (r.some((x) => selector(x) === selector(v)) ? r : r.concat([v])), []);
};
export const distinct = (items) => {
  return [...new Set(items)];
  //return distinctBy(items, selfSelector);
};
export const union = (arr1, arr2) => {
  return distinct(toArray(arr1).concat(toArray(arr2)));
};
export const take = (items, n) => {
  return toArray(items).slice(0, n);
};
export const skip = (items, n) => {
  return toArray(items).slice(n);
};
export const page = (items, pageSize, pageIndex = 0) => {
  const skip = pageSize * pageIndex;
  return toArray(items).slice(skip, skip + pageSize);
};
export const countPages = (items, pageSize) => {
  const totalSize = toArray(items).length;
  return Math.ceil(totalSize / pageSize);
};

export const min = (items, selector = selfSelector) => {
  //return Math.min(...items.map(selector)); -> only numeric
  const arr = toArray(items);
  if (!arr.length) {
    return undefined;
  }
  return arr.reduce((r, x) => {
    const v = selector(x);
    return r == null || v < r ? v : r;
  }, null);
};
export const max = (items, selector = selfSelector) => {
  //return Math.max(...items.map(selector)); -> only numeric
  const arr = toArray(items);
  if (!arr.length) {
    return undefined;
  }
  return arr.reduce((r, x) => {
    const v = selector(x);
    return r == null || v > r ? v : r;
  }, null);
};
export const sum = (items, selector = selfSelector) => {
  return toArray(items).reduce((r, x) => r + selector(x), 0);
};
export const average = (items, selector) => {
  return sum(items, selector) / items.length;
};
export const toMap = (items, keySelector, valueSelector = selfSelector) => {
  const arr = toArray(items);
  return arr.reduce((map, item, i) => {
    const key = keySelector(item);
    const value = valueSelector(item, i, map);
    return map.set(key, value);
  }, new Map());
  // const entries = groupBy(items, keySelector).map(x => [x[0], x[1].map(valueSelector)]);
  // return new Map(entries);
};
export const sameContent = (items1, items2, includeOrder = true) => {
  if (items1 === items2) {
    return true;
  }
  if (items1 == null || items2 == null) {
    return false;
  }
  const arr1 = toArray(items1);
  const arr2 = toArray(items2);
  if (arr1.length !== arr2.length) {
    return false;
  }
  if (includeOrder) {
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) {
        return false;
      }
    }
    return true;
  }
  // same order not required
  return innerJoin(arr1, arr2).length === arr1.length;
};

export const query = (items, filter) => {
  const arr = toArray(items);
  return arr.filter((x) => filterObject(x, filter));
};
export const getEnumerator = (arr) => {
  let index = 0;
  return {
    get selectedIndex() {
      return index;
    },
    set selectedIndex(value) {
      if (value >= 0 && value < arr.length) {
        index = value;
      }
    },
    get length() {
      return arr.length;
    },
    get current() {
      if (index >= 0 && index < arr.length) {
        return arr[index];
      }
      return null;
    },
    first() {
      index = 0;
    },
    previous() {
      if (index > 0) {
        index--;
      }
      return index > 0;
    },
    next() {
      if (index < arr.length - 1) {
        index++;
      }
      return index < arr.length;
    },
    last() {
      index = arr.length - 1;
    },
  };
};

// no pure functions
export const move = (arr, item, pos) => {
  const index = arr.indexOf(item);
  if (index !== -1) {
    arr.splice(index, 1);
    arr.splice(pos, 0, item);
  }
};
export const reFill = (arr, values) => {
  arr.splice(0, arr.length, ...values);
};

export default {
  isArray,
  isIterable,
  toArray,
  newArray,
  orderBy,
  orderByDesc,
  naturalSort,
  shuffle,
  innerJoin,
  groupBy,
  groupJoin,
  count,
  first,
  last,
  distinctBy,
  distinct,
  union,
  take,
  skip,
  page,
  countPages,
  min,
  max,
  sum,
  average,
  toMap,
  sameContent,
  query,
  getEnumerator,
  move,
  reFill,
};
