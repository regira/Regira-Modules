import { trim } from "./string-utility";

// consider using https://www.npmjs.com/package/is-plain-object
export const isPlainObject = (obj) => typeof obj === "object" && Object.prototype.toString.call(obj) === "[object Object]";

export const flattenObject = (obj) => {
  const getKey = (key, prefix) => (prefix === "" ? key : `${prefix}.${key}`);
  const flattenProperties = (obj, prefix = "", result = {}) => {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        flattenProperties(obj, `${prefix}[${i}]`, result);
      }
    } else if (typeof obj !== "object") {
      result[prefix] = obj;
    } else {
      for (const entry of Object.entries(obj)) {
        const name = entry[0];
        const value = entry[1];
        if (Array.isArray(value)) {
          for (let i in value) {
            const arrKey = getKey(`${name}[${i}]`, prefix);
            flattenProperties(value[i], arrKey, result);
          }
        } else {
          const objKey = getKey(name, prefix);
          if (typeof value === "object" && Object.keys(value).length > 0) {
            flattenProperties(value, objKey, result);
          } else {
            result[objKey] = value;
          }
        }
      }
    }
    return result;
  };

  return flattenProperties(obj);
};
export const crawlObject = (obj, key) => key.split(".").reduce((res, p) => (res == null ? null : res[p]), obj);
export const removeEmpty = (obj) =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => value != null)
      .map(([key, value]) => (typeof value === "object" ? [key, removeEmpty(value)] : [key, value]))
  );

export const deepCopy = (obj) => {
  // https://github.com/vuejs/vuex/blob/dev/src/util.js

  const find = (list, f) => list.filter(f)[0];
  const copyWithCache = (o, cache = []) => {
    if (o === null || typeof o !== "object") {
      return o;
    }

    const hit = find(cache, (c) => c.original === o);
    if (hit) {
      return hit.copy;
    }

    if (o instanceof Date) {
      return new Date(o);
    }

    const copy = Array.isArray(o) ? [] : {};
    cache.push({ original: o, copy });

    Object.keys(o).forEach((key) => {
      copy[key] = copyWithCache(o[key], cache);
    });

    return copy;
  };

  return copyWithCache(obj);
};

export const mixin = (target, ...rest) => {
  // https://github.com/jonschlinkert/mixin-deep/blob/master/index.js
  function mixin(target, val, key) {
    const obj = target[key];
    if (isPlainObject(val) && isPlainObject(obj)) {
      target[key] = merge(obj, val);
    } else {
      target[key] = val;
    }
    return target;
  }
  function merge(obj1, obj2) {
    return Object.keys(obj2).reduce((obj, key) => mixin(obj, obj2[key], key), obj1);
  }

  return rest.reduce((r, obj) => merge(r, obj), target);
};

const getKeys = (keyFilter) => (keyFilter ? Object.keys(keyFilter).filter((x) => typeof keyFilter[x] !== "undefined") : []);
export const filterObject = (obj, filter) => {
  const keys = getKeys(filter);
  return (
    !keys.length ||
    keys.every((key) => {
      if (typeof filter[key] === "function") {
        return filter[key].apply(obj, key);
      }
      if (filter[key] instanceof Date || typeof filter[key] === "number") {
        if (!(key in obj)) {
          const objKey = key[3].toLowerCase() + (key.length > 4 ? key.substr(4) : "");
          if (key.startsWith("min")) {
            return obj[objKey] >= filter[key];
          }
          if (key.startsWith("max")) {
            return obj[objKey] <= filter[key];
          }
        }
      }
      //add wildcard to key so logic can be inside views
      const trimmedKey = trim(key, "*");
      if (typeof filter[key] === "string" && typeof obj[trimmedKey] === "string") {
        var value = filter[key];
        if (key.startsWith("*") && key.endsWith("*")) {
          return obj[trimmedKey].includes(value);
        } else if (key.startsWith("*")) {
          return obj[trimmedKey].endsWith(value);
        } else if (key.endsWith("*")) {
          return obj[trimmedKey].startsWith(value);
        }
      }
      if (key in obj) {
        if (Array.isArray(filter[key]) && !Array.isArray(obj[key])) {
          return filter[key].includes(obj[key]);
        } else if (Array.isArray(obj[key]) && !Array.isArray(filter[key])) {
          return obj[key].includes(filter[key]);
        } else if (Array.isArray(obj[key]) && Array.isArray(filter[key])) {
          return filter[key].every((fk) => obj[key].includes(fk));
        }
        if (filter[key] instanceof Object) {
          // recursive call
          return filterObject(obj[key], filter[key]);
        }
        return obj[key] === filter[key];
      }
      return true;
    })
  );
};

export default {
  isPlainObject,
  flattenObject,
  crawlObject,
  mixin,
  filterObject,
};
