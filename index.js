import http$1 from 'http';
import https from 'https';
import url from 'url';
import stream from 'stream';
import assert from 'assert';
import tty from 'tty';
import util from 'util';
import os from 'os';
import zlib from 'zlib';

class Event {
	constructor(type, src, data) {
		this.type = type;
		this.src = src;
		if (data != null) {
			Object.keys(data).forEach((key) => {
				if (!(key in this)) {
					this[key] = data[key];
				}
			});
		}
	}
}

const getOptions = (argArray) => {
	const key = argArray[0];
	const options = argArray.splice(0, 1)[0];
	const callback = options.callback || argArray[argArray.length - 1];
	const constraint = options.constraint || (
		argArray.length > 2
			? argArray.splice(0, 1).find(function (x) { return x !== callback && typeof (x) === 'function'; })
			: undefined
	);
	const thisScope = options.scope;
	return {
		key: key || '',
		constraint: constraint,
		callback: callback,
		thisScope: thisScope
	};
};
function setListener(options) {
	const me = this;
	options.key.split(' ').forEach(function (x) {
		if (!(x in me.listeners)) {
			me.listeners[x] = [];
		}
		const listener = {
			constraint: options.constraint,
			callback: options.callback,
			scope: options.thisScope,
			once: options.once
		};
		me.listeners[x].push(listener);
	});
}

class EventHandler { }

EventHandler.injectInto = function (target) {
	Object.defineProperties(target, {
		listeners: {
			get: function () {
				//create new object per instance
				if (!('_listeners' in this)) {
					Object.defineProperty(this, '_listeners', { value: {} });
				}
				return this._listeners;
			}
		},
		on: {
			value: function (/*key, constraint, callback*/) {
				const options = getOptions([...arguments]);
				setListener.call(this, options);
				return this;
			},
			configurable: true
		},
		once: {
			value: function (/*key, constraint, callback*/) {
				const options = getOptions([...arguments]);
				options.once = true;
				setListener.call(this, options);
				return this;
			},
			configurable: true
		},
		off: {
			value: function (key, listener) {
				if (this.listeners[key]) {
					if (this.listeners[key].length && typeof listener === 'function') {
						const index = this.listeners[key].findIndex(function (x) { return x.callback === listener; });
						if (index >= 0) {
							this.listeners[key].splice(index, 1);
						}
					}
					if (!this.listeners[key].length || listener == null) {
						delete this.listeners[key];
					}
				}
				return this;
			},
			configurable: true
		},
		trigger: {
			value: async function (e, arg) {
				const me = this;
				const event = typeof e === 'string' ? new Event(e) : e;
				const results = [];
				const listeners = (me.listeners[event.type] || []).concat(me.listeners[''])
					.filter(x => {
						return x && (x.constraint == null || x.constraint.call(x.scope || me, e, arg));
					})
					.map(x => {
						if (x.once) {
							me.off(event.type, x.callback);
						}
						return () => {
							try {
								const result = x.callback.call(x.scope || me, event, arg || {});
								return Promise.resolve(result)
							} catch (error) {
								console.error('Executing listener failed', { error: error, event: event, listener: x.callback });
								return Promise.resolve(error);
							}
						};
					});

				return listeners
					.reduce((r, f) => {
						return r.then(f).then(result => {
							results.push(result);
							return result;
						});
					}, Promise.resolve())
					.then(() => results);
			},
			configurable: true
		}
	});
};
EventHandler.injectInto(EventHandler.prototype);

class EntityManager {
  constructor(service, { enableCount = true, defaults = { searchObject: {} } } = {}) {
    this._defaults = {
      ...defaults
    };
    this._service = service;
    this.state = {
      details: undefined,
      items: undefined,
      count: undefined,
      searchObject: this._defaults.searchObject
    };
    this.reset();
    this._enableCount = !!enableCount;
  }

  async details(id) {
    const original = this.state.details;
    const args = [id].concat([...arguments].slice(1));
    const item = await this._service.details.apply(this._service, args);
    this.setDetails(item);
    await this.trigger("change-details", { original, item });
    return this.state.details;
  }
  // deprecated -> use search instead
  async list(searchObject = {}) {
    const original = this.state.items;
    this.setSearchObject(searchObject);
    const args = [this.state.searchObject].concat([...arguments].slice(1));
    const items = await this._service.list.apply(this._service, args);
    this.setItems(items);
    await this.trigger("change-items", { original, items });
    return this.state.items;
  }
  // deprecated -> use search instead
  async count(searchObject = {}) {
    const original = this.state.count;
    this.setSearchObject(searchObject);
    const args = [this.state.searchObject].concat([...arguments].slice(1));
    const count = await this._service.count.apply(this._service, args);
    this.setCount(count);
    await this.trigger("change-count", { original, count });
    return this.state.count;
  }
  async search(searchObject = this.state.searchObject) {
    const original = {
      searchObject: this.state.searchObject,
      items: this.state.items,
      count: this.state.count
    };
    this.setSearchObject(searchObject);
    const args = [this.state.searchObject].concat([...arguments].slice(1));
    let count = undefined;
    if (this._enableCount) {
      count = await this._service.count.apply(this._service, args);
      this.setCount(count);
    }
    const items = !this._enableCount || count > 0
      ? await this._service.list.apply(this._service, args)
      : [];
    this.setItems(items);
    const state = { searchObject, items, count };
    await this.trigger("search", { original, state });
    return state;
  }
  async save(item = null) {
    const itemToSave = item || this.state.details;
    const args = [itemToSave].concat([...arguments].slice(1));
    const saved = await this._service.save.apply(this._service, args);
    if (!item || item === this.state.details) {
      this.setDetails(saved);
    }
    if (this.state.items != null) {
      const newItems = [...this.state.items];
      const itemIndex = newItems.findIndex(x => x.id === itemToSave.id);
      if (itemIndex !== -1) {
        newItems.splice(itemIndex, 1, saved);
      } else {
        newItems.push(saved);
      }
      this.setItems(newItems);
    }
    await this.trigger("save-item", { original: itemToSave, saved });
    return saved;
  }
  async delete(item = null) {
    const itemToDelete = item || this.state.details;
    const args = [itemToDelete].concat([...arguments].slice(1));
    await this._service.delete.apply(this._service, args);
    if (this.state.items != null) {
      const newItems = this.state.items.filter(x => x.id !== itemToDelete.id);
      this.setItems(newItems);
    }
    // if (this.state.details && this.state.details.id === itemToDelete.id) {
    //   this.setDetails(null);
    // }
    await this.trigger("delete-item", { item: itemToDelete });
    return itemToDelete;
  }

  async newItem() {
    const newItem = {};
    return this.setDetails(newItem);
  }
  setDetails(item) {
    this.state.details = item;
  }
  setItems(items) {
    this.state.items = items;
  }
  setCount(count) {
    this.state.count = count;
  }
  setSearchObject(searchObject = {}) {
    this.state.searchObject = searchObject;
  }

  reset() {
    this.state.items = undefined;
    this.state.details = undefined;
    this.state.count = undefined;
    this.state.searchObject = {};
  }
}
EventHandler.injectInto(EntityManager.prototype);

var bind = function bind(fn, thisArg) {
  return function wrap() {
    var args = new Array(arguments.length);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i];
    }
    return fn.apply(thisArg, args);
  };
};

// utils is a library of generic helper functions non-specific to axios

var toString = Object.prototype.toString;

/**
 * Determine if a value is an Array
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Array, otherwise false
 */
function isArray$2(val) {
  return Array.isArray(val);
}

/**
 * Determine if a value is undefined
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if the value is undefined, otherwise false
 */
function isUndefined(val) {
  return typeof val === 'undefined';
}

/**
 * Determine if a value is a Buffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Buffer, otherwise false
 */
function isBuffer(val) {
  return val !== null && !isUndefined(val) && val.constructor !== null && !isUndefined(val.constructor)
    && typeof val.constructor.isBuffer === 'function' && val.constructor.isBuffer(val);
}

/**
 * Determine if a value is an ArrayBuffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an ArrayBuffer, otherwise false
 */
function isArrayBuffer(val) {
  return toString.call(val) === '[object ArrayBuffer]';
}

/**
 * Determine if a value is a FormData
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an FormData, otherwise false
 */
function isFormData(val) {
  return toString.call(val) === '[object FormData]';
}

/**
 * Determine if a value is a view on an ArrayBuffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a view on an ArrayBuffer, otherwise false
 */
function isArrayBufferView(val) {
  var result;
  if ((typeof ArrayBuffer !== 'undefined') && (ArrayBuffer.isView)) {
    result = ArrayBuffer.isView(val);
  } else {
    result = (val) && (val.buffer) && (isArrayBuffer(val.buffer));
  }
  return result;
}

/**
 * Determine if a value is a String
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a String, otherwise false
 */
function isString(val) {
  return typeof val === 'string';
}

/**
 * Determine if a value is a Number
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Number, otherwise false
 */
function isNumber(val) {
  return typeof val === 'number';
}

/**
 * Determine if a value is an Object
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Object, otherwise false
 */
function isObject(val) {
  return val !== null && typeof val === 'object';
}

/**
 * Determine if a value is a plain Object
 *
 * @param {Object} val The value to test
 * @return {boolean} True if value is a plain Object, otherwise false
 */
function isPlainObject$1(val) {
  if (toString.call(val) !== '[object Object]') {
    return false;
  }

  var prototype = Object.getPrototypeOf(val);
  return prototype === null || prototype === Object.prototype;
}

/**
 * Determine if a value is a Date
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Date, otherwise false
 */
function isDate(val) {
  return toString.call(val) === '[object Date]';
}

/**
 * Determine if a value is a File
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a File, otherwise false
 */
function isFile$1(val) {
  return toString.call(val) === '[object File]';
}

/**
 * Determine if a value is a Blob
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Blob, otherwise false
 */
function isBlob(val) {
  return toString.call(val) === '[object Blob]';
}

/**
 * Determine if a value is a Function
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Function, otherwise false
 */
function isFunction(val) {
  return toString.call(val) === '[object Function]';
}

/**
 * Determine if a value is a Stream
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Stream, otherwise false
 */
function isStream(val) {
  return isObject(val) && isFunction(val.pipe);
}

/**
 * Determine if a value is a URLSearchParams object
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a URLSearchParams object, otherwise false
 */
function isURLSearchParams(val) {
  return toString.call(val) === '[object URLSearchParams]';
}

/**
 * Trim excess whitespace off the beginning and end of a string
 *
 * @param {String} str The String to trim
 * @returns {String} The String freed of excess whitespace
 */
function trim$1(str) {
  return str.trim ? str.trim() : str.replace(/^\s+|\s+$/g, '');
}

/**
 * Determine if we're running in a standard browser environment
 *
 * This allows axios to run in a web worker, and react-native.
 * Both environments support XMLHttpRequest, but not fully standard globals.
 *
 * web workers:
 *  typeof window -> undefined
 *  typeof document -> undefined
 *
 * react-native:
 *  navigator.product -> 'ReactNative'
 * nativescript
 *  navigator.product -> 'NativeScript' or 'NS'
 */
function isStandardBrowserEnv() {
  if (typeof navigator !== 'undefined' && (navigator.product === 'ReactNative' ||
                                           navigator.product === 'NativeScript' ||
                                           navigator.product === 'NS')) {
    return false;
  }
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

/**
 * Iterate over an Array or an Object invoking a function for each item.
 *
 * If `obj` is an Array callback will be called passing
 * the value, index, and complete array for each item.
 *
 * If 'obj' is an Object callback will be called passing
 * the value, key, and complete object for each property.
 *
 * @param {Object|Array} obj The object to iterate
 * @param {Function} fn The callback to invoke for each item
 */
function forEach(obj, fn) {
  // Don't bother if no value provided
  if (obj === null || typeof obj === 'undefined') {
    return;
  }

  // Force an array if not already something iterable
  if (typeof obj !== 'object') {
    /*eslint no-param-reassign:0*/
    obj = [obj];
  }

  if (isArray$2(obj)) {
    // Iterate over array values
    for (var i = 0, l = obj.length; i < l; i++) {
      fn.call(null, obj[i], i, obj);
    }
  } else {
    // Iterate over object keys
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        fn.call(null, obj[key], key, obj);
      }
    }
  }
}

/**
 * Accepts varargs expecting each argument to be an object, then
 * immutably merges the properties of each object and returns result.
 *
 * When multiple objects contain the same key the later object in
 * the arguments list will take precedence.
 *
 * Example:
 *
 * ```js
 * var result = merge({foo: 123}, {foo: 456});
 * console.log(result.foo); // outputs 456
 * ```
 *
 * @param {Object} obj1 Object to merge
 * @returns {Object} Result of all merge properties
 */
function merge(/* obj1, obj2, obj3, ... */) {
  var result = {};
  function assignValue(val, key) {
    if (isPlainObject$1(result[key]) && isPlainObject$1(val)) {
      result[key] = merge(result[key], val);
    } else if (isPlainObject$1(val)) {
      result[key] = merge({}, val);
    } else if (isArray$2(val)) {
      result[key] = val.slice();
    } else {
      result[key] = val;
    }
  }

  for (var i = 0, l = arguments.length; i < l; i++) {
    forEach(arguments[i], assignValue);
  }
  return result;
}

/**
 * Extends object a by mutably adding to it the properties of object b.
 *
 * @param {Object} a The object to be extended
 * @param {Object} b The object to copy properties from
 * @param {Object} thisArg The object to bind function to
 * @return {Object} The resulting value of object a
 */
function extend(a, b, thisArg) {
  forEach(b, function assignValue(val, key) {
    if (thisArg && typeof val === 'function') {
      a[key] = bind(val, thisArg);
    } else {
      a[key] = val;
    }
  });
  return a;
}

/**
 * Remove byte order marker. This catches EF BB BF (the UTF-8 BOM)
 *
 * @param {string} content with BOM
 * @return {string} content value without BOM
 */
function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return content;
}

var utils = {
  isArray: isArray$2,
  isArrayBuffer: isArrayBuffer,
  isBuffer: isBuffer,
  isFormData: isFormData,
  isArrayBufferView: isArrayBufferView,
  isString: isString,
  isNumber: isNumber,
  isObject: isObject,
  isPlainObject: isPlainObject$1,
  isUndefined: isUndefined,
  isDate: isDate,
  isFile: isFile$1,
  isBlob: isBlob,
  isFunction: isFunction,
  isStream: isStream,
  isURLSearchParams: isURLSearchParams,
  isStandardBrowserEnv: isStandardBrowserEnv,
  forEach: forEach,
  merge: merge,
  extend: extend,
  trim: trim$1,
  stripBOM: stripBOM
};

function encode(val) {
  return encodeURIComponent(val).
    replace(/%3A/gi, ':').
    replace(/%24/g, '$').
    replace(/%2C/gi, ',').
    replace(/%20/g, '+').
    replace(/%5B/gi, '[').
    replace(/%5D/gi, ']');
}

/**
 * Build a URL by appending params to the end
 *
 * @param {string} url The base of the url (e.g., http://www.google.com)
 * @param {object} [params] The params to be appended
 * @returns {string} The formatted url
 */
var buildURL = function buildURL(url, params, paramsSerializer) {
  /*eslint no-param-reassign:0*/
  if (!params) {
    return url;
  }

  var serializedParams;
  if (paramsSerializer) {
    serializedParams = paramsSerializer(params);
  } else if (utils.isURLSearchParams(params)) {
    serializedParams = params.toString();
  } else {
    var parts = [];

    utils.forEach(params, function serialize(val, key) {
      if (val === null || typeof val === 'undefined') {
        return;
      }

      if (utils.isArray(val)) {
        key = key + '[]';
      } else {
        val = [val];
      }

      utils.forEach(val, function parseValue(v) {
        if (utils.isDate(v)) {
          v = v.toISOString();
        } else if (utils.isObject(v)) {
          v = JSON.stringify(v);
        }
        parts.push(encode(key) + '=' + encode(v));
      });
    });

    serializedParams = parts.join('&');
  }

  if (serializedParams) {
    var hashmarkIndex = url.indexOf('#');
    if (hashmarkIndex !== -1) {
      url = url.slice(0, hashmarkIndex);
    }

    url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
  }

  return url;
};

function InterceptorManager() {
  this.handlers = [];
}

/**
 * Add a new interceptor to the stack
 *
 * @param {Function} fulfilled The function to handle `then` for a `Promise`
 * @param {Function} rejected The function to handle `reject` for a `Promise`
 *
 * @return {Number} An ID used to remove interceptor later
 */
InterceptorManager.prototype.use = function use(fulfilled, rejected, options) {
  this.handlers.push({
    fulfilled: fulfilled,
    rejected: rejected,
    synchronous: options ? options.synchronous : false,
    runWhen: options ? options.runWhen : null
  });
  return this.handlers.length - 1;
};

/**
 * Remove an interceptor from the stack
 *
 * @param {Number} id The ID that was returned by `use`
 */
InterceptorManager.prototype.eject = function eject(id) {
  if (this.handlers[id]) {
    this.handlers[id] = null;
  }
};

/**
 * Iterate over all the registered interceptors
 *
 * This method is particularly useful for skipping over any
 * interceptors that may have become `null` calling `eject`.
 *
 * @param {Function} fn The function to call for each interceptor
 */
InterceptorManager.prototype.forEach = function forEach(fn) {
  utils.forEach(this.handlers, function forEachHandler(h) {
    if (h !== null) {
      fn(h);
    }
  });
};

var InterceptorManager_1 = InterceptorManager;

var normalizeHeaderName = function normalizeHeaderName(headers, normalizedName) {
  utils.forEach(headers, function processHeader(value, name) {
    if (name !== normalizedName && name.toUpperCase() === normalizedName.toUpperCase()) {
      headers[normalizedName] = value;
      delete headers[name];
    }
  });
};

/**
 * Update an Error with the specified config, error code, and response.
 *
 * @param {Error} error The error to update.
 * @param {Object} config The config.
 * @param {string} [code] The error code (for example, 'ECONNABORTED').
 * @param {Object} [request] The request.
 * @param {Object} [response] The response.
 * @returns {Error} The error.
 */
var enhanceError = function enhanceError(error, config, code, request, response) {
  error.config = config;
  if (code) {
    error.code = code;
  }

  error.request = request;
  error.response = response;
  error.isAxiosError = true;

  error.toJSON = function toJSON() {
    return {
      // Standard
      message: this.message,
      name: this.name,
      // Microsoft
      description: this.description,
      number: this.number,
      // Mozilla
      fileName: this.fileName,
      lineNumber: this.lineNumber,
      columnNumber: this.columnNumber,
      stack: this.stack,
      // Axios
      config: this.config,
      code: this.code,
      status: this.response && this.response.status ? this.response.status : null
    };
  };
  return error;
};

/**
 * Create an Error with the specified message, config, error code, request and response.
 *
 * @param {string} message The error message.
 * @param {Object} config The config.
 * @param {string} [code] The error code (for example, 'ECONNABORTED').
 * @param {Object} [request] The request.
 * @param {Object} [response] The response.
 * @returns {Error} The created error.
 */
var createError = function createError(message, config, code, request, response) {
  var error = new Error(message);
  return enhanceError(error, config, code, request, response);
};

/**
 * Resolve or reject a Promise based on response status.
 *
 * @param {Function} resolve A function that resolves the promise.
 * @param {Function} reject A function that rejects the promise.
 * @param {object} response The response.
 */
var settle = function settle(resolve, reject, response) {
  var validateStatus = response.config.validateStatus;
  if (!response.status || !validateStatus || validateStatus(response.status)) {
    resolve(response);
  } else {
    reject(createError(
      'Request failed with status code ' + response.status,
      response.config,
      null,
      response.request,
      response
    ));
  }
};

var cookies = (
  utils.isStandardBrowserEnv() ?

  // Standard browser envs support document.cookie
    (function standardBrowserEnv() {
      return {
        write: function write(name, value, expires, path, domain, secure) {
          var cookie = [];
          cookie.push(name + '=' + encodeURIComponent(value));

          if (utils.isNumber(expires)) {
            cookie.push('expires=' + new Date(expires).toGMTString());
          }

          if (utils.isString(path)) {
            cookie.push('path=' + path);
          }

          if (utils.isString(domain)) {
            cookie.push('domain=' + domain);
          }

          if (secure === true) {
            cookie.push('secure');
          }

          document.cookie = cookie.join('; ');
        },

        read: function read(name) {
          var match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
          return (match ? decodeURIComponent(match[3]) : null);
        },

        remove: function remove(name) {
          this.write(name, '', Date.now() - 86400000);
        }
      };
    })() :

  // Non standard browser env (web workers, react-native) lack needed support.
    (function nonStandardBrowserEnv() {
      return {
        write: function write() {},
        read: function read() { return null; },
        remove: function remove() {}
      };
    })()
);

/**
 * Determines whether the specified URL is absolute
 *
 * @param {string} url The URL to test
 * @returns {boolean} True if the specified URL is absolute, otherwise false
 */
var isAbsoluteURL = function isAbsoluteURL(url) {
  // A URL is considered absolute if it begins with "<scheme>://" or "//" (protocol-relative URL).
  // RFC 3986 defines scheme name as a sequence of characters beginning with a letter and followed
  // by any combination of letters, digits, plus, period, or hyphen.
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
};

/**
 * Creates a new URL by combining the specified URLs
 *
 * @param {string} baseURL The base URL
 * @param {string} relativeURL The relative URL
 * @returns {string} The combined URL
 */
var combineURLs = function combineURLs(baseURL, relativeURL) {
  return relativeURL
    ? baseURL.replace(/\/+$/, '') + '/' + relativeURL.replace(/^\/+/, '')
    : baseURL;
};

/**
 * Creates a new URL by combining the baseURL with the requestedURL,
 * only when the requestedURL is not already an absolute URL.
 * If the requestURL is absolute, this function returns the requestedURL untouched.
 *
 * @param {string} baseURL The base URL
 * @param {string} requestedURL Absolute or relative URL to combine
 * @returns {string} The combined full path
 */
var buildFullPath = function buildFullPath(baseURL, requestedURL) {
  if (baseURL && !isAbsoluteURL(requestedURL)) {
    return combineURLs(baseURL, requestedURL);
  }
  return requestedURL;
};

// Headers whose duplicates are ignored by node
// c.f. https://nodejs.org/api/http.html#http_message_headers
var ignoreDuplicateOf = [
  'age', 'authorization', 'content-length', 'content-type', 'etag',
  'expires', 'from', 'host', 'if-modified-since', 'if-unmodified-since',
  'last-modified', 'location', 'max-forwards', 'proxy-authorization',
  'referer', 'retry-after', 'user-agent'
];

/**
 * Parse headers into an object
 *
 * ```
 * Date: Wed, 27 Aug 2014 08:58:49 GMT
 * Content-Type: application/json
 * Connection: keep-alive
 * Transfer-Encoding: chunked
 * ```
 *
 * @param {String} headers Headers needing to be parsed
 * @returns {Object} Headers parsed into an object
 */
var parseHeaders = function parseHeaders(headers) {
  var parsed = {};
  var key;
  var val;
  var i;

  if (!headers) { return parsed; }

  utils.forEach(headers.split('\n'), function parser(line) {
    i = line.indexOf(':');
    key = utils.trim(line.substr(0, i)).toLowerCase();
    val = utils.trim(line.substr(i + 1));

    if (key) {
      if (parsed[key] && ignoreDuplicateOf.indexOf(key) >= 0) {
        return;
      }
      if (key === 'set-cookie') {
        parsed[key] = (parsed[key] ? parsed[key] : []).concat([val]);
      } else {
        parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
      }
    }
  });

  return parsed;
};

var isURLSameOrigin = (
  utils.isStandardBrowserEnv() ?

  // Standard browser envs have full support of the APIs needed to test
  // whether the request URL is of the same origin as current location.
    (function standardBrowserEnv() {
      var msie = /(msie|trident)/i.test(navigator.userAgent);
      var urlParsingNode = document.createElement('a');
      var originURL;

      /**
    * Parse a URL to discover it's components
    *
    * @param {String} url The URL to be parsed
    * @returns {Object}
    */
      function resolveURL(url) {
        var href = url;

        if (msie) {
        // IE needs attribute set twice to normalize properties
          urlParsingNode.setAttribute('href', href);
          href = urlParsingNode.href;
        }

        urlParsingNode.setAttribute('href', href);

        // urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
        return {
          href: urlParsingNode.href,
          protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
          host: urlParsingNode.host,
          search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
          hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
          hostname: urlParsingNode.hostname,
          port: urlParsingNode.port,
          pathname: (urlParsingNode.pathname.charAt(0) === '/') ?
            urlParsingNode.pathname :
            '/' + urlParsingNode.pathname
        };
      }

      originURL = resolveURL(window.location.href);

      /**
    * Determine if a URL shares the same origin as the current location
    *
    * @param {String} requestURL The URL to test
    * @returns {boolean} True if URL shares the same origin, otherwise false
    */
      return function isURLSameOrigin(requestURL) {
        var parsed = (utils.isString(requestURL)) ? resolveURL(requestURL) : requestURL;
        return (parsed.protocol === originURL.protocol &&
            parsed.host === originURL.host);
      };
    })() :

  // Non standard browser envs (web workers, react-native) lack needed support.
    (function nonStandardBrowserEnv() {
      return function isURLSameOrigin() {
        return true;
      };
    })()
);

/**
 * A `Cancel` is an object that is thrown when an operation is canceled.
 *
 * @class
 * @param {string=} message The message.
 */
function Cancel(message) {
  this.message = message;
}

Cancel.prototype.toString = function toString() {
  return 'Cancel' + (this.message ? ': ' + this.message : '');
};

Cancel.prototype.__CANCEL__ = true;

var Cancel_1 = Cancel;

var defaults$1 = defaults_1;

var xhr = function xhrAdapter(config) {
  return new Promise(function dispatchXhrRequest(resolve, reject) {
    var requestData = config.data;
    var requestHeaders = config.headers;
    var responseType = config.responseType;
    var onCanceled;
    function done() {
      if (config.cancelToken) {
        config.cancelToken.unsubscribe(onCanceled);
      }

      if (config.signal) {
        config.signal.removeEventListener('abort', onCanceled);
      }
    }

    if (utils.isFormData(requestData)) {
      delete requestHeaders['Content-Type']; // Let the browser set it
    }

    var request = new XMLHttpRequest();

    // HTTP basic authentication
    if (config.auth) {
      var username = config.auth.username || '';
      var password = config.auth.password ? unescape(encodeURIComponent(config.auth.password)) : '';
      requestHeaders.Authorization = 'Basic ' + btoa(username + ':' + password);
    }

    var fullPath = buildFullPath(config.baseURL, config.url);
    request.open(config.method.toUpperCase(), buildURL(fullPath, config.params, config.paramsSerializer), true);

    // Set the request timeout in MS
    request.timeout = config.timeout;

    function onloadend() {
      if (!request) {
        return;
      }
      // Prepare the response
      var responseHeaders = 'getAllResponseHeaders' in request ? parseHeaders(request.getAllResponseHeaders()) : null;
      var responseData = !responseType || responseType === 'text' ||  responseType === 'json' ?
        request.responseText : request.response;
      var response = {
        data: responseData,
        status: request.status,
        statusText: request.statusText,
        headers: responseHeaders,
        config: config,
        request: request
      };

      settle(function _resolve(value) {
        resolve(value);
        done();
      }, function _reject(err) {
        reject(err);
        done();
      }, response);

      // Clean up request
      request = null;
    }

    if ('onloadend' in request) {
      // Use onloadend if available
      request.onloadend = onloadend;
    } else {
      // Listen for ready state to emulate onloadend
      request.onreadystatechange = function handleLoad() {
        if (!request || request.readyState !== 4) {
          return;
        }

        // The request errored out and we didn't get a response, this will be
        // handled by onerror instead
        // With one exception: request that using file: protocol, most browsers
        // will return status as 0 even though it's a successful request
        if (request.status === 0 && !(request.responseURL && request.responseURL.indexOf('file:') === 0)) {
          return;
        }
        // readystate handler is calling before onerror or ontimeout handlers,
        // so we should call onloadend on the next 'tick'
        setTimeout(onloadend);
      };
    }

    // Handle browser request cancellation (as opposed to a manual cancellation)
    request.onabort = function handleAbort() {
      if (!request) {
        return;
      }

      reject(createError('Request aborted', config, 'ECONNABORTED', request));

      // Clean up request
      request = null;
    };

    // Handle low level network errors
    request.onerror = function handleError() {
      // Real errors are hidden from us by the browser
      // onerror should only fire if it's a network error
      reject(createError('Network Error', config, null, request));

      // Clean up request
      request = null;
    };

    // Handle timeout
    request.ontimeout = function handleTimeout() {
      var timeoutErrorMessage = config.timeout ? 'timeout of ' + config.timeout + 'ms exceeded' : 'timeout exceeded';
      var transitional = config.transitional || defaults$1.transitional;
      if (config.timeoutErrorMessage) {
        timeoutErrorMessage = config.timeoutErrorMessage;
      }
      reject(createError(
        timeoutErrorMessage,
        config,
        transitional.clarifyTimeoutError ? 'ETIMEDOUT' : 'ECONNABORTED',
        request));

      // Clean up request
      request = null;
    };

    // Add xsrf header
    // This is only done if running in a standard browser environment.
    // Specifically not if we're in a web worker, or react-native.
    if (utils.isStandardBrowserEnv()) {
      // Add xsrf header
      var xsrfValue = (config.withCredentials || isURLSameOrigin(fullPath)) && config.xsrfCookieName ?
        cookies.read(config.xsrfCookieName) :
        undefined;

      if (xsrfValue) {
        requestHeaders[config.xsrfHeaderName] = xsrfValue;
      }
    }

    // Add headers to the request
    if ('setRequestHeader' in request) {
      utils.forEach(requestHeaders, function setRequestHeader(val, key) {
        if (typeof requestData === 'undefined' && key.toLowerCase() === 'content-type') {
          // Remove Content-Type if data is undefined
          delete requestHeaders[key];
        } else {
          // Otherwise add header to the request
          request.setRequestHeader(key, val);
        }
      });
    }

    // Add withCredentials to request if needed
    if (!utils.isUndefined(config.withCredentials)) {
      request.withCredentials = !!config.withCredentials;
    }

    // Add responseType to request if needed
    if (responseType && responseType !== 'json') {
      request.responseType = config.responseType;
    }

    // Handle progress if needed
    if (typeof config.onDownloadProgress === 'function') {
      request.addEventListener('progress', config.onDownloadProgress);
    }

    // Not all browsers support upload events
    if (typeof config.onUploadProgress === 'function' && request.upload) {
      request.upload.addEventListener('progress', config.onUploadProgress);
    }

    if (config.cancelToken || config.signal) {
      // Handle cancellation
      // eslint-disable-next-line func-names
      onCanceled = function(cancel) {
        if (!request) {
          return;
        }
        reject(!cancel || (cancel && cancel.type) ? new Cancel_1('canceled') : cancel);
        request.abort();
        request = null;
      };

      config.cancelToken && config.cancelToken.subscribe(onCanceled);
      if (config.signal) {
        config.signal.aborted ? onCanceled() : config.signal.addEventListener('abort', onCanceled);
      }
    }

    if (!requestData) {
      requestData = null;
    }

    // Send the request
    request.send(requestData);
  });
};

function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

/**
 * Helpers.
 */

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;
var w = d * 7;
var y = d * 365.25;

/**
 * Parse or format the given `val`.
 *
 * Options:
 *
 *  - `long` verbose formatting [false]
 *
 * @param {String|Number} val
 * @param {Object} [options]
 * @throws {Error} throw an error if val is not a non-empty string or a number
 * @return {String|Number}
 * @api public
 */

var ms = function(val, options) {
  options = options || {};
  var type = typeof val;
  if (type === 'string' && val.length > 0) {
    return parse(val);
  } else if (type === 'number' && isFinite(val)) {
    return options.long ? fmtLong(val) : fmtShort(val);
  }
  throw new Error(
    'val is not a non-empty string or a valid number. val=' +
      JSON.stringify(val)
  );
};

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function parse(str) {
  str = String(str);
  if (str.length > 100) {
    return;
  }
  var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
    str
  );
  if (!match) {
    return;
  }
  var n = parseFloat(match[1]);
  var type = (match[2] || 'ms').toLowerCase();
  switch (type) {
    case 'years':
    case 'year':
    case 'yrs':
    case 'yr':
    case 'y':
      return n * y;
    case 'weeks':
    case 'week':
    case 'w':
      return n * w;
    case 'days':
    case 'day':
    case 'd':
      return n * d;
    case 'hours':
    case 'hour':
    case 'hrs':
    case 'hr':
    case 'h':
      return n * h;
    case 'minutes':
    case 'minute':
    case 'mins':
    case 'min':
    case 'm':
      return n * m;
    case 'seconds':
    case 'second':
    case 'secs':
    case 'sec':
    case 's':
      return n * s;
    case 'milliseconds':
    case 'millisecond':
    case 'msecs':
    case 'msec':
    case 'ms':
      return n;
    default:
      return undefined;
  }
}

/**
 * Short format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtShort(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= d) {
    return Math.round(ms / d) + 'd';
  }
  if (msAbs >= h) {
    return Math.round(ms / h) + 'h';
  }
  if (msAbs >= m) {
    return Math.round(ms / m) + 'm';
  }
  if (msAbs >= s) {
    return Math.round(ms / s) + 's';
  }
  return ms + 'ms';
}

/**
 * Long format for `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api private
 */

function fmtLong(ms) {
  var msAbs = Math.abs(ms);
  if (msAbs >= d) {
    return plural(ms, msAbs, d, 'day');
  }
  if (msAbs >= h) {
    return plural(ms, msAbs, h, 'hour');
  }
  if (msAbs >= m) {
    return plural(ms, msAbs, m, 'minute');
  }
  if (msAbs >= s) {
    return plural(ms, msAbs, s, 'second');
  }
  return ms + ' ms';
}

/**
 * Pluralization helper.
 */

function plural(ms, msAbs, n, name) {
  var isPlural = msAbs >= n * 1.5;
  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
}

/**
 * This is the common logic for both the Node.js and web browser
 * implementations of `debug()`.
 */

function setup(env) {
	createDebug.debug = createDebug;
	createDebug.default = createDebug;
	createDebug.coerce = coerce;
	createDebug.disable = disable;
	createDebug.enable = enable;
	createDebug.enabled = enabled;
	createDebug.humanize = ms;
	createDebug.destroy = destroy;

	Object.keys(env).forEach(key => {
		createDebug[key] = env[key];
	});

	/**
	* The currently active debug mode names, and names to skip.
	*/

	createDebug.names = [];
	createDebug.skips = [];

	/**
	* Map of special "%n" handling functions, for the debug "format" argument.
	*
	* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
	*/
	createDebug.formatters = {};

	/**
	* Selects a color for a debug namespace
	* @param {String} namespace The namespace string for the debug instance to be colored
	* @return {Number|String} An ANSI color code for the given namespace
	* @api private
	*/
	function selectColor(namespace) {
		let hash = 0;

		for (let i = 0; i < namespace.length; i++) {
			hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
			hash |= 0; // Convert to 32bit integer
		}

		return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
	}
	createDebug.selectColor = selectColor;

	/**
	* Create a debugger with the given `namespace`.
	*
	* @param {String} namespace
	* @return {Function}
	* @api public
	*/
	function createDebug(namespace) {
		let prevTime;
		let enableOverride = null;
		let namespacesCache;
		let enabledCache;

		function debug(...args) {
			// Disabled?
			if (!debug.enabled) {
				return;
			}

			const self = debug;

			// Set `diff` timestamp
			const curr = Number(new Date());
			const ms = curr - (prevTime || curr);
			self.diff = ms;
			self.prev = prevTime;
			self.curr = curr;
			prevTime = curr;

			args[0] = createDebug.coerce(args[0]);

			if (typeof args[0] !== 'string') {
				// Anything else let's inspect with %O
				args.unshift('%O');
			}

			// Apply any `formatters` transformations
			let index = 0;
			args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
				// If we encounter an escaped % then don't increase the array index
				if (match === '%%') {
					return '%';
				}
				index++;
				const formatter = createDebug.formatters[format];
				if (typeof formatter === 'function') {
					const val = args[index];
					match = formatter.call(self, val);

					// Now we need to remove `args[index]` since it's inlined in the `format`
					args.splice(index, 1);
					index--;
				}
				return match;
			});

			// Apply env-specific formatting (colors, etc.)
			createDebug.formatArgs.call(self, args);

			const logFn = self.log || createDebug.log;
			logFn.apply(self, args);
		}

		debug.namespace = namespace;
		debug.useColors = createDebug.useColors();
		debug.color = createDebug.selectColor(namespace);
		debug.extend = extend;
		debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.

		Object.defineProperty(debug, 'enabled', {
			enumerable: true,
			configurable: false,
			get: () => {
				if (enableOverride !== null) {
					return enableOverride;
				}
				if (namespacesCache !== createDebug.namespaces) {
					namespacesCache = createDebug.namespaces;
					enabledCache = createDebug.enabled(namespace);
				}

				return enabledCache;
			},
			set: v => {
				enableOverride = v;
			}
		});

		// Env-specific initialization logic for debug instances
		if (typeof createDebug.init === 'function') {
			createDebug.init(debug);
		}

		return debug;
	}

	function extend(namespace, delimiter) {
		const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
		newDebug.log = this.log;
		return newDebug;
	}

	/**
	* Enables a debug mode by namespaces. This can include modes
	* separated by a colon and wildcards.
	*
	* @param {String} namespaces
	* @api public
	*/
	function enable(namespaces) {
		createDebug.save(namespaces);
		createDebug.namespaces = namespaces;

		createDebug.names = [];
		createDebug.skips = [];

		let i;
		const split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
		const len = split.length;

		for (i = 0; i < len; i++) {
			if (!split[i]) {
				// ignore empty strings
				continue;
			}

			namespaces = split[i].replace(/\*/g, '.*?');

			if (namespaces[0] === '-') {
				createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
			} else {
				createDebug.names.push(new RegExp('^' + namespaces + '$'));
			}
		}
	}

	/**
	* Disable debug output.
	*
	* @return {String} namespaces
	* @api public
	*/
	function disable() {
		const namespaces = [
			...createDebug.names.map(toNamespace),
			...createDebug.skips.map(toNamespace).map(namespace => '-' + namespace)
		].join(',');
		createDebug.enable('');
		return namespaces;
	}

	/**
	* Returns true if the given mode name is enabled, false otherwise.
	*
	* @param {String} name
	* @return {Boolean}
	* @api public
	*/
	function enabled(name) {
		if (name[name.length - 1] === '*') {
			return true;
		}

		let i;
		let len;

		for (i = 0, len = createDebug.skips.length; i < len; i++) {
			if (createDebug.skips[i].test(name)) {
				return false;
			}
		}

		for (i = 0, len = createDebug.names.length; i < len; i++) {
			if (createDebug.names[i].test(name)) {
				return true;
			}
		}

		return false;
	}

	/**
	* Convert regexp to namespace
	*
	* @param {RegExp} regxep
	* @return {String} namespace
	* @api private
	*/
	function toNamespace(regexp) {
		return regexp.toString()
			.substring(2, regexp.toString().length - 2)
			.replace(/\.\*\?$/, '*');
	}

	/**
	* Coerce `val`.
	*
	* @param {Mixed} val
	* @return {Mixed}
	* @api private
	*/
	function coerce(val) {
		if (val instanceof Error) {
			return val.stack || val.message;
		}
		return val;
	}

	/**
	* XXX DO NOT USE. This is a temporary stub function.
	* XXX It WILL be removed in the next major release.
	*/
	function destroy() {
		console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
	}

	createDebug.enable(createDebug.load());

	return createDebug;
}

var common = setup;

var browser = createCommonjsModule(function (module, exports) {
/* eslint-env browser */

/**
 * This is the web browser implementation of `debug()`.
 */

exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.storage = localstorage();
exports.destroy = (() => {
	let warned = false;

	return () => {
		if (!warned) {
			warned = true;
			console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
		}
	};
})();

/**
 * Colors.
 */

exports.colors = [
	'#0000CC',
	'#0000FF',
	'#0033CC',
	'#0033FF',
	'#0066CC',
	'#0066FF',
	'#0099CC',
	'#0099FF',
	'#00CC00',
	'#00CC33',
	'#00CC66',
	'#00CC99',
	'#00CCCC',
	'#00CCFF',
	'#3300CC',
	'#3300FF',
	'#3333CC',
	'#3333FF',
	'#3366CC',
	'#3366FF',
	'#3399CC',
	'#3399FF',
	'#33CC00',
	'#33CC33',
	'#33CC66',
	'#33CC99',
	'#33CCCC',
	'#33CCFF',
	'#6600CC',
	'#6600FF',
	'#6633CC',
	'#6633FF',
	'#66CC00',
	'#66CC33',
	'#9900CC',
	'#9900FF',
	'#9933CC',
	'#9933FF',
	'#99CC00',
	'#99CC33',
	'#CC0000',
	'#CC0033',
	'#CC0066',
	'#CC0099',
	'#CC00CC',
	'#CC00FF',
	'#CC3300',
	'#CC3333',
	'#CC3366',
	'#CC3399',
	'#CC33CC',
	'#CC33FF',
	'#CC6600',
	'#CC6633',
	'#CC9900',
	'#CC9933',
	'#CCCC00',
	'#CCCC33',
	'#FF0000',
	'#FF0033',
	'#FF0066',
	'#FF0099',
	'#FF00CC',
	'#FF00FF',
	'#FF3300',
	'#FF3333',
	'#FF3366',
	'#FF3399',
	'#FF33CC',
	'#FF33FF',
	'#FF6600',
	'#FF6633',
	'#FF9900',
	'#FF9933',
	'#FFCC00',
	'#FFCC33'
];

/**
 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
 * and the Firebug extension (any Firefox version) are known
 * to support "%c" CSS customizations.
 *
 * TODO: add a `localStorage` variable to explicitly enable/disable colors
 */

// eslint-disable-next-line complexity
function useColors() {
	// NB: In an Electron preload script, document will be defined but not fully
	// initialized. Since we know we're in Chrome, we'll just detect this case
	// explicitly
	if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
		return true;
	}

	// Internet Explorer and Edge do not support colors.
	if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
		return false;
	}

	// Is webkit? http://stackoverflow.com/a/16459606/376773
	// document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
	return (typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance) ||
		// Is firebug? http://stackoverflow.com/a/398120/376773
		(typeof window !== 'undefined' && window.console && (window.console.firebug || (window.console.exception && window.console.table))) ||
		// Is firefox >= v31?
		// https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31) ||
		// Double check webkit in userAgent just in case we are in a worker
		(typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/));
}

/**
 * Colorize log arguments if enabled.
 *
 * @api public
 */

function formatArgs(args) {
	args[0] = (this.useColors ? '%c' : '') +
		this.namespace +
		(this.useColors ? ' %c' : ' ') +
		args[0] +
		(this.useColors ? '%c ' : ' ') +
		'+' + module.exports.humanize(this.diff);

	if (!this.useColors) {
		return;
	}

	const c = 'color: ' + this.color;
	args.splice(1, 0, c, 'color: inherit');

	// The final "%c" is somewhat tricky, because there could be other
	// arguments passed either before or after the %c, so we need to
	// figure out the correct index to insert the CSS into
	let index = 0;
	let lastC = 0;
	args[0].replace(/%[a-zA-Z%]/g, match => {
		if (match === '%%') {
			return;
		}
		index++;
		if (match === '%c') {
			// We only are interested in the *last* %c
			// (the user may have provided their own)
			lastC = index;
		}
	});

	args.splice(lastC, 0, c);
}

/**
 * Invokes `console.debug()` when available.
 * No-op when `console.debug` is not a "function".
 * If `console.debug` is not available, falls back
 * to `console.log`.
 *
 * @api public
 */
exports.log = console.debug || console.log || (() => {});

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */
function save(namespaces) {
	try {
		if (namespaces) {
			exports.storage.setItem('debug', namespaces);
		} else {
			exports.storage.removeItem('debug');
		}
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */
function load() {
	let r;
	try {
		r = exports.storage.getItem('debug');
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}

	// If debug isn't set in LS, and we're in Electron, try to load $DEBUG
	if (!r && typeof process !== 'undefined' && 'env' in process) {
		r = process.env.DEBUG;
	}

	return r;
}

/**
 * Localstorage attempts to return the localstorage.
 *
 * This is necessary because safari throws
 * when a user disables cookies/localstorage
 * and you attempt to access it.
 *
 * @return {LocalStorage}
 * @api private
 */

function localstorage() {
	try {
		// TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
		// The Browser also has localStorage in the global context.
		return localStorage;
	} catch (error) {
		// Swallow
		// XXX (@Qix-) should we be logging these?
	}
}

module.exports = common(exports);

const {formatters} = module.exports;

/**
 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
 */

formatters.j = function (v) {
	try {
		return JSON.stringify(v);
	} catch (error) {
		return '[UnexpectedJSONParseError]: ' + error.message;
	}
};
});
browser.formatArgs;
browser.save;
browser.load;
browser.useColors;
browser.storage;
browser.destroy;
browser.colors;
browser.log;

var hasFlag = (flag, argv) => {
	argv = argv || process.argv;
	const prefix = flag.startsWith('-') ? '' : (flag.length === 1 ? '-' : '--');
	const pos = argv.indexOf(prefix + flag);
	const terminatorPos = argv.indexOf('--');
	return pos !== -1 && (terminatorPos === -1 ? true : pos < terminatorPos);
};

const env = process.env;

let forceColor;
if (hasFlag('no-color') ||
	hasFlag('no-colors') ||
	hasFlag('color=false')) {
	forceColor = false;
} else if (hasFlag('color') ||
	hasFlag('colors') ||
	hasFlag('color=true') ||
	hasFlag('color=always')) {
	forceColor = true;
}
if ('FORCE_COLOR' in env) {
	forceColor = env.FORCE_COLOR.length === 0 || parseInt(env.FORCE_COLOR, 10) !== 0;
}

function translateLevel(level) {
	if (level === 0) {
		return false;
	}

	return {
		level,
		hasBasic: true,
		has256: level >= 2,
		has16m: level >= 3
	};
}

function supportsColor(stream) {
	if (forceColor === false) {
		return 0;
	}

	if (hasFlag('color=16m') ||
		hasFlag('color=full') ||
		hasFlag('color=truecolor')) {
		return 3;
	}

	if (hasFlag('color=256')) {
		return 2;
	}

	if (stream && !stream.isTTY && forceColor !== true) {
		return 0;
	}

	const min = forceColor ? 1 : 0;

	if (process.platform === 'win32') {
		// Node.js 7.5.0 is the first version of Node.js to include a patch to
		// libuv that enables 256 color output on Windows. Anything earlier and it
		// won't work. However, here we target Node.js 8 at minimum as it is an LTS
		// release, and Node.js 7 is not. Windows 10 build 10586 is the first Windows
		// release that supports 256 colors. Windows 10 build 14931 is the first release
		// that supports 16m/TrueColor.
		const osRelease = os.release().split('.');
		if (
			Number(process.versions.node.split('.')[0]) >= 8 &&
			Number(osRelease[0]) >= 10 &&
			Number(osRelease[2]) >= 10586
		) {
			return Number(osRelease[2]) >= 14931 ? 3 : 2;
		}

		return 1;
	}

	if ('CI' in env) {
		if (['TRAVIS', 'CIRCLECI', 'APPVEYOR', 'GITLAB_CI'].some(sign => sign in env) || env.CI_NAME === 'codeship') {
			return 1;
		}

		return min;
	}

	if ('TEAMCITY_VERSION' in env) {
		return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
	}

	if (env.COLORTERM === 'truecolor') {
		return 3;
	}

	if ('TERM_PROGRAM' in env) {
		const version = parseInt((env.TERM_PROGRAM_VERSION || '').split('.')[0], 10);

		switch (env.TERM_PROGRAM) {
			case 'iTerm.app':
				return version >= 3 ? 3 : 2;
			case 'Apple_Terminal':
				return 2;
			// No default
		}
	}

	if (/-256(color)?$/i.test(env.TERM)) {
		return 2;
	}

	if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
		return 1;
	}

	if ('COLORTERM' in env) {
		return 1;
	}

	if (env.TERM === 'dumb') {
		return min;
	}

	return min;
}

function getSupportLevel(stream) {
	const level = supportsColor(stream);
	return translateLevel(level);
}

var supportsColor_1 = {
	supportsColor: getSupportLevel,
	stdout: getSupportLevel(process.stdout),
	stderr: getSupportLevel(process.stderr)
};
supportsColor_1.supportsColor;
supportsColor_1.stdout;
supportsColor_1.stderr;

var node = createCommonjsModule(function (module, exports) {
/**
 * Module dependencies.
 */




/**
 * This is the Node.js implementation of `debug()`.
 */

exports.init = init;
exports.log = log;
exports.formatArgs = formatArgs;
exports.save = save;
exports.load = load;
exports.useColors = useColors;
exports.destroy = util.deprecate(
	() => {},
	'Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.'
);

/**
 * Colors.
 */

exports.colors = [6, 2, 3, 4, 5, 1];

try {
	// Optional dependency (as in, doesn't need to be installed, NOT like optionalDependencies in package.json)
	// eslint-disable-next-line import/no-extraneous-dependencies
	const supportsColor = supportsColor_1;

	if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
		exports.colors = [
			20,
			21,
			26,
			27,
			32,
			33,
			38,
			39,
			40,
			41,
			42,
			43,
			44,
			45,
			56,
			57,
			62,
			63,
			68,
			69,
			74,
			75,
			76,
			77,
			78,
			79,
			80,
			81,
			92,
			93,
			98,
			99,
			112,
			113,
			128,
			129,
			134,
			135,
			148,
			149,
			160,
			161,
			162,
			163,
			164,
			165,
			166,
			167,
			168,
			169,
			170,
			171,
			172,
			173,
			178,
			179,
			184,
			185,
			196,
			197,
			198,
			199,
			200,
			201,
			202,
			203,
			204,
			205,
			206,
			207,
			208,
			209,
			214,
			215,
			220,
			221
		];
	}
} catch (error) {
	// Swallow - we only care if `supports-color` is available; it doesn't have to be.
}

/**
 * Build up the default `inspectOpts` object from the environment variables.
 *
 *   $ DEBUG_COLORS=no DEBUG_DEPTH=10 DEBUG_SHOW_HIDDEN=enabled node script.js
 */

exports.inspectOpts = Object.keys(process.env).filter(key => {
	return /^debug_/i.test(key);
}).reduce((obj, key) => {
	// Camel-case
	const prop = key
		.substring(6)
		.toLowerCase()
		.replace(/_([a-z])/g, (_, k) => {
			return k.toUpperCase();
		});

	// Coerce string value into JS value
	let val = process.env[key];
	if (/^(yes|on|true|enabled)$/i.test(val)) {
		val = true;
	} else if (/^(no|off|false|disabled)$/i.test(val)) {
		val = false;
	} else if (val === 'null') {
		val = null;
	} else {
		val = Number(val);
	}

	obj[prop] = val;
	return obj;
}, {});

/**
 * Is stdout a TTY? Colored output is enabled when `true`.
 */

function useColors() {
	return 'colors' in exports.inspectOpts ?
		Boolean(exports.inspectOpts.colors) :
		tty.isatty(process.stderr.fd);
}

/**
 * Adds ANSI color escape codes if enabled.
 *
 * @api public
 */

function formatArgs(args) {
	const {namespace: name, useColors} = this;

	if (useColors) {
		const c = this.color;
		const colorCode = '\u001B[3' + (c < 8 ? c : '8;5;' + c);
		const prefix = `  ${colorCode};1m${name} \u001B[0m`;

		args[0] = prefix + args[0].split('\n').join('\n' + prefix);
		args.push(colorCode + 'm+' + module.exports.humanize(this.diff) + '\u001B[0m');
	} else {
		args[0] = getDate() + name + ' ' + args[0];
	}
}

function getDate() {
	if (exports.inspectOpts.hideDate) {
		return '';
	}
	return new Date().toISOString() + ' ';
}

/**
 * Invokes `util.format()` with the specified arguments and writes to stderr.
 */

function log(...args) {
	return process.stderr.write(util.format(...args) + '\n');
}

/**
 * Save `namespaces`.
 *
 * @param {String} namespaces
 * @api private
 */
function save(namespaces) {
	if (namespaces) {
		process.env.DEBUG = namespaces;
	} else {
		// If you set a process.env field to null or undefined, it gets cast to the
		// string 'null' or 'undefined'. Just delete instead.
		delete process.env.DEBUG;
	}
}

/**
 * Load `namespaces`.
 *
 * @return {String} returns the previously persisted debug modes
 * @api private
 */

function load() {
	return process.env.DEBUG;
}

/**
 * Init logic for `debug` instances.
 *
 * Create a new `inspectOpts` object in case `useColors` is set
 * differently for a particular `debug` instance.
 */

function init(debug) {
	debug.inspectOpts = {};

	const keys = Object.keys(exports.inspectOpts);
	for (let i = 0; i < keys.length; i++) {
		debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
	}
}

module.exports = common(exports);

const {formatters} = module.exports;

/**
 * Map %o to `util.inspect()`, all on a single line.
 */

formatters.o = function (v) {
	this.inspectOpts.colors = this.useColors;
	return util.inspect(v, this.inspectOpts)
		.split('\n')
		.map(str => str.trim())
		.join(' ');
};

/**
 * Map %O to `util.inspect()`, allowing multiple lines if needed.
 */

formatters.O = function (v) {
	this.inspectOpts.colors = this.useColors;
	return util.inspect(v, this.inspectOpts);
};
});
node.init;
node.log;
node.formatArgs;
node.save;
node.load;
node.useColors;
node.destroy;
node.colors;
node.inspectOpts;

var src = createCommonjsModule(function (module) {
/**
 * Detect Electron renderer / nwjs process, which is node, but we should
 * treat as a browser.
 */

if (typeof process === 'undefined' || process.type === 'renderer' || process.browser === true || process.__nwjs) {
	module.exports = browser;
} else {
	module.exports = node;
}
});

var debug;

var debug_1 = function () {
  if (!debug) {
    try {
      /* eslint global-require: off */
      debug = src("follow-redirects");
    }
    catch (error) { /* */ }
    if (typeof debug !== "function") {
      debug = function () { /* */ };
    }
  }
  debug.apply(null, arguments);
};

var URL$1 = url.URL;


var Writable = stream.Writable;



// Create handlers that pass events from native requests
var events$1 = ["abort", "aborted", "connect", "error", "socket", "timeout"];
var eventHandlers = Object.create(null);
events$1.forEach(function (event) {
  eventHandlers[event] = function (arg1, arg2, arg3) {
    this._redirectable.emit(event, arg1, arg2, arg3);
  };
});

// Error types with codes
var RedirectionError = createErrorType(
  "ERR_FR_REDIRECTION_FAILURE",
  "Redirected request failed"
);
var TooManyRedirectsError = createErrorType(
  "ERR_FR_TOO_MANY_REDIRECTS",
  "Maximum number of redirects exceeded"
);
var MaxBodyLengthExceededError = createErrorType(
  "ERR_FR_MAX_BODY_LENGTH_EXCEEDED",
  "Request body larger than maxBodyLength limit"
);
var WriteAfterEndError = createErrorType(
  "ERR_STREAM_WRITE_AFTER_END",
  "write after end"
);

// An HTTP(S) request that can be redirected
function RedirectableRequest(options, responseCallback) {
  // Initialize the request
  Writable.call(this);
  this._sanitizeOptions(options);
  this._options = options;
  this._ended = false;
  this._ending = false;
  this._redirectCount = 0;
  this._redirects = [];
  this._requestBodyLength = 0;
  this._requestBodyBuffers = [];

  // Attach a callback if passed
  if (responseCallback) {
    this.on("response", responseCallback);
  }

  // React to responses of native requests
  var self = this;
  this._onNativeResponse = function (response) {
    self._processResponse(response);
  };

  // Perform the first request
  this._performRequest();
}
RedirectableRequest.prototype = Object.create(Writable.prototype);

RedirectableRequest.prototype.abort = function () {
  abortRequest(this._currentRequest);
  this.emit("abort");
};

// Writes buffered data to the current native request
RedirectableRequest.prototype.write = function (data, encoding, callback) {
  // Writing is not allowed if end has been called
  if (this._ending) {
    throw new WriteAfterEndError();
  }

  // Validate input and shift parameters if necessary
  if (!(typeof data === "string" || typeof data === "object" && ("length" in data))) {
    throw new TypeError("data should be a string, Buffer or Uint8Array");
  }
  if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }

  // Ignore empty buffers, since writing them doesn't invoke the callback
  // https://github.com/nodejs/node/issues/22066
  if (data.length === 0) {
    if (callback) {
      callback();
    }
    return;
  }
  // Only write when we don't exceed the maximum body length
  if (this._requestBodyLength + data.length <= this._options.maxBodyLength) {
    this._requestBodyLength += data.length;
    this._requestBodyBuffers.push({ data: data, encoding: encoding });
    this._currentRequest.write(data, encoding, callback);
  }
  // Error when we exceed the maximum body length
  else {
    this.emit("error", new MaxBodyLengthExceededError());
    this.abort();
  }
};

// Ends the current native request
RedirectableRequest.prototype.end = function (data, encoding, callback) {
  // Shift parameters if necessary
  if (typeof data === "function") {
    callback = data;
    data = encoding = null;
  }
  else if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }

  // Write data if needed and end
  if (!data) {
    this._ended = this._ending = true;
    this._currentRequest.end(null, null, callback);
  }
  else {
    var self = this;
    var currentRequest = this._currentRequest;
    this.write(data, encoding, function () {
      self._ended = true;
      currentRequest.end(null, null, callback);
    });
    this._ending = true;
  }
};

// Sets a header value on the current native request
RedirectableRequest.prototype.setHeader = function (name, value) {
  this._options.headers[name] = value;
  this._currentRequest.setHeader(name, value);
};

// Clears a header value on the current native request
RedirectableRequest.prototype.removeHeader = function (name) {
  delete this._options.headers[name];
  this._currentRequest.removeHeader(name);
};

// Global timeout for all underlying requests
RedirectableRequest.prototype.setTimeout = function (msecs, callback) {
  var self = this;

  // Destroys the socket on timeout
  function destroyOnTimeout(socket) {
    socket.setTimeout(msecs);
    socket.removeListener("timeout", socket.destroy);
    socket.addListener("timeout", socket.destroy);
  }

  // Sets up a timer to trigger a timeout event
  function startTimer(socket) {
    if (self._timeout) {
      clearTimeout(self._timeout);
    }
    self._timeout = setTimeout(function () {
      self.emit("timeout");
      clearTimer();
    }, msecs);
    destroyOnTimeout(socket);
  }

  // Stops a timeout from triggering
  function clearTimer() {
    // Clear the timeout
    if (self._timeout) {
      clearTimeout(self._timeout);
      self._timeout = null;
    }

    // Clean up all attached listeners
    self.removeListener("abort", clearTimer);
    self.removeListener("error", clearTimer);
    self.removeListener("response", clearTimer);
    if (callback) {
      self.removeListener("timeout", callback);
    }
    if (!self.socket) {
      self._currentRequest.removeListener("socket", startTimer);
    }
  }

  // Attach callback if passed
  if (callback) {
    this.on("timeout", callback);
  }

  // Start the timer if or when the socket is opened
  if (this.socket) {
    startTimer(this.socket);
  }
  else {
    this._currentRequest.once("socket", startTimer);
  }

  // Clean up on events
  this.on("socket", destroyOnTimeout);
  this.on("abort", clearTimer);
  this.on("error", clearTimer);
  this.on("response", clearTimer);

  return this;
};

// Proxy all other public ClientRequest methods
[
  "flushHeaders", "getHeader",
  "setNoDelay", "setSocketKeepAlive",
].forEach(function (method) {
  RedirectableRequest.prototype[method] = function (a, b) {
    return this._currentRequest[method](a, b);
  };
});

// Proxy all public ClientRequest properties
["aborted", "connection", "socket"].forEach(function (property) {
  Object.defineProperty(RedirectableRequest.prototype, property, {
    get: function () { return this._currentRequest[property]; },
  });
});

RedirectableRequest.prototype._sanitizeOptions = function (options) {
  // Ensure headers are always present
  if (!options.headers) {
    options.headers = {};
  }

  // Since http.request treats host as an alias of hostname,
  // but the url module interprets host as hostname plus port,
  // eliminate the host property to avoid confusion.
  if (options.host) {
    // Use hostname if set, because it has precedence
    if (!options.hostname) {
      options.hostname = options.host;
    }
    delete options.host;
  }

  // Complete the URL object when necessary
  if (!options.pathname && options.path) {
    var searchPos = options.path.indexOf("?");
    if (searchPos < 0) {
      options.pathname = options.path;
    }
    else {
      options.pathname = options.path.substring(0, searchPos);
      options.search = options.path.substring(searchPos);
    }
  }
};


// Executes the next native request (initial or redirect)
RedirectableRequest.prototype._performRequest = function () {
  // Load the native protocol
  var protocol = this._options.protocol;
  var nativeProtocol = this._options.nativeProtocols[protocol];
  if (!nativeProtocol) {
    this.emit("error", new TypeError("Unsupported protocol " + protocol));
    return;
  }

  // If specified, use the agent corresponding to the protocol
  // (HTTP and HTTPS use different types of agents)
  if (this._options.agents) {
    var scheme = protocol.substr(0, protocol.length - 1);
    this._options.agent = this._options.agents[scheme];
  }

  // Create the native request
  var request = this._currentRequest =
        nativeProtocol.request(this._options, this._onNativeResponse);
  this._currentUrl = url.format(this._options);

  // Set up event handlers
  request._redirectable = this;
  for (var e = 0; e < events$1.length; e++) {
    request.on(events$1[e], eventHandlers[events$1[e]]);
  }

  // End a redirected request
  // (The first request must be ended explicitly with RedirectableRequest#end)
  if (this._isRedirect) {
    // Write the request entity and end.
    var i = 0;
    var self = this;
    var buffers = this._requestBodyBuffers;
    (function writeNext(error) {
      // Only write if this request has not been redirected yet
      /* istanbul ignore else */
      if (request === self._currentRequest) {
        // Report any write errors
        /* istanbul ignore if */
        if (error) {
          self.emit("error", error);
        }
        // Write the next buffer if there are still left
        else if (i < buffers.length) {
          var buffer = buffers[i++];
          /* istanbul ignore else */
          if (!request.finished) {
            request.write(buffer.data, buffer.encoding, writeNext);
          }
        }
        // End the request if `end` has been called on us
        else if (self._ended) {
          request.end();
        }
      }
    }());
  }
};

// Processes a response from the current native request
RedirectableRequest.prototype._processResponse = function (response) {
  // Store the redirected response
  var statusCode = response.statusCode;
  if (this._options.trackRedirects) {
    this._redirects.push({
      url: this._currentUrl,
      headers: response.headers,
      statusCode: statusCode,
    });
  }

  // RFC7231§6.4: The 3xx (Redirection) class of status code indicates
  // that further action needs to be taken by the user agent in order to
  // fulfill the request. If a Location header field is provided,
  // the user agent MAY automatically redirect its request to the URI
  // referenced by the Location field value,
  // even if the specific status code is not understood.
  var location = response.headers.location;
  if (location && this._options.followRedirects !== false &&
      statusCode >= 300 && statusCode < 400) {
    // Abort the current request
    abortRequest(this._currentRequest);
    // Discard the remainder of the response to avoid waiting for data
    response.destroy();

    // RFC7231§6.4: A client SHOULD detect and intervene
    // in cyclical redirections (i.e., "infinite" redirection loops).
    if (++this._redirectCount > this._options.maxRedirects) {
      this.emit("error", new TooManyRedirectsError());
      return;
    }

    // RFC7231§6.4: Automatic redirection needs to done with
    // care for methods not known to be safe, […]
    // RFC7231§6.4.2–3: For historical reasons, a user agent MAY change
    // the request method from POST to GET for the subsequent request.
    if ((statusCode === 301 || statusCode === 302) && this._options.method === "POST" ||
        // RFC7231§6.4.4: The 303 (See Other) status code indicates that
        // the server is redirecting the user agent to a different resource […]
        // A user agent can perform a retrieval request targeting that URI
        // (a GET or HEAD request if using HTTP) […]
        (statusCode === 303) && !/^(?:GET|HEAD)$/.test(this._options.method)) {
      this._options.method = "GET";
      // Drop a possible entity and headers related to it
      this._requestBodyBuffers = [];
      removeMatchingHeaders(/^content-/i, this._options.headers);
    }

    // Drop the Host header, as the redirect might lead to a different host
    var currentHostHeader = removeMatchingHeaders(/^host$/i, this._options.headers);

    // If the redirect is relative, carry over the host of the last request
    var currentUrlParts = url.parse(this._currentUrl);
    var currentHost = currentHostHeader || currentUrlParts.host;
    var currentUrl = /^\w+:/.test(location) ? this._currentUrl :
      url.format(Object.assign(currentUrlParts, { host: currentHost }));

    // Determine the URL of the redirection
    var redirectUrl;
    try {
      redirectUrl = url.resolve(currentUrl, location);
    }
    catch (cause) {
      this.emit("error", new RedirectionError(cause));
      return;
    }

    // Create the redirected request
    debug_1("redirecting to", redirectUrl);
    this._isRedirect = true;
    var redirectUrlParts = url.parse(redirectUrl);
    Object.assign(this._options, redirectUrlParts);

    // Drop confidential headers when redirecting to another scheme:domain
    if (redirectUrlParts.protocol !== currentUrlParts.protocol ||
       !isSameOrSubdomain(redirectUrlParts.host, currentHost)) {
      removeMatchingHeaders(/^(?:authorization|cookie)$/i, this._options.headers);
    }

    // Evaluate the beforeRedirect callback
    if (typeof this._options.beforeRedirect === "function") {
      var responseDetails = { headers: response.headers };
      try {
        this._options.beforeRedirect.call(null, this._options, responseDetails);
      }
      catch (err) {
        this.emit("error", err);
        return;
      }
      this._sanitizeOptions(this._options);
    }

    // Perform the redirected request
    try {
      this._performRequest();
    }
    catch (cause) {
      this.emit("error", new RedirectionError(cause));
    }
  }
  else {
    // The response is not a redirect; return it as-is
    response.responseUrl = this._currentUrl;
    response.redirects = this._redirects;
    this.emit("response", response);

    // Clean up
    this._requestBodyBuffers = [];
  }
};

// Wraps the key/value object of protocols with redirect functionality
function wrap(protocols) {
  // Default settings
  var exports = {
    maxRedirects: 21,
    maxBodyLength: 10 * 1024 * 1024,
  };

  // Wrap each protocol
  var nativeProtocols = {};
  Object.keys(protocols).forEach(function (scheme) {
    var protocol = scheme + ":";
    var nativeProtocol = nativeProtocols[protocol] = protocols[scheme];
    var wrappedProtocol = exports[scheme] = Object.create(nativeProtocol);

    // Executes a request, following redirects
    function request(input, options, callback) {
      // Parse parameters
      if (typeof input === "string") {
        var urlStr = input;
        try {
          input = urlToOptions(new URL$1(urlStr));
        }
        catch (err) {
          /* istanbul ignore next */
          input = url.parse(urlStr);
        }
      }
      else if (URL$1 && (input instanceof URL$1)) {
        input = urlToOptions(input);
      }
      else {
        callback = options;
        options = input;
        input = { protocol: protocol };
      }
      if (typeof options === "function") {
        callback = options;
        options = null;
      }

      // Set defaults
      options = Object.assign({
        maxRedirects: exports.maxRedirects,
        maxBodyLength: exports.maxBodyLength,
      }, input, options);
      options.nativeProtocols = nativeProtocols;

      assert.equal(options.protocol, protocol, "protocol mismatch");
      debug_1("options", options);
      return new RedirectableRequest(options, callback);
    }

    // Executes a GET request, following redirects
    function get(input, options, callback) {
      var wrappedRequest = wrappedProtocol.request(input, options, callback);
      wrappedRequest.end();
      return wrappedRequest;
    }

    // Expose the properties on the wrapped protocol
    Object.defineProperties(wrappedProtocol, {
      request: { value: request, configurable: true, enumerable: true, writable: true },
      get: { value: get, configurable: true, enumerable: true, writable: true },
    });
  });
  return exports;
}

/* istanbul ignore next */
function noop() { /* empty */ }

// from https://github.com/nodejs/node/blob/master/lib/internal/url.js
function urlToOptions(urlObject) {
  var options = {
    protocol: urlObject.protocol,
    hostname: urlObject.hostname.startsWith("[") ?
      /* istanbul ignore next */
      urlObject.hostname.slice(1, -1) :
      urlObject.hostname,
    hash: urlObject.hash,
    search: urlObject.search,
    pathname: urlObject.pathname,
    path: urlObject.pathname + urlObject.search,
    href: urlObject.href,
  };
  if (urlObject.port !== "") {
    options.port = Number(urlObject.port);
  }
  return options;
}

function removeMatchingHeaders(regex, headers) {
  var lastValue;
  for (var header in headers) {
    if (regex.test(header)) {
      lastValue = headers[header];
      delete headers[header];
    }
  }
  return (lastValue === null || typeof lastValue === "undefined") ?
    undefined : String(lastValue).trim();
}

function createErrorType(code, defaultMessage) {
  function CustomError(cause) {
    Error.captureStackTrace(this, this.constructor);
    if (!cause) {
      this.message = defaultMessage;
    }
    else {
      this.message = defaultMessage + ": " + cause.message;
      this.cause = cause;
    }
  }
  CustomError.prototype = new Error();
  CustomError.prototype.constructor = CustomError;
  CustomError.prototype.name = "Error [" + code + "]";
  CustomError.prototype.code = code;
  return CustomError;
}

function abortRequest(request) {
  for (var e = 0; e < events$1.length; e++) {
    request.removeListener(events$1[e], eventHandlers[events$1[e]]);
  }
  request.on("error", noop);
  request.abort();
}

function isSameOrSubdomain(subdomain, domain) {
  if (subdomain === domain) {
    return true;
  }
  const dot = subdomain.length - domain.length - 1;
  return dot > 0 && subdomain[dot] === "." && subdomain.endsWith(domain);
}

// Exports
var followRedirects = wrap({ http: http$1, https: https });
var wrap_1 = wrap;
followRedirects.wrap = wrap_1;

var data = {
  "version": "0.26.0"
};

var httpFollow = followRedirects.http;
var httpsFollow = followRedirects.https;


var VERSION$1 = data.version;





var isHttps$1 = /https:?/;

/**
 *
 * @param {http.ClientRequestArgs} options
 * @param {AxiosProxyConfig} proxy
 * @param {string} location
 */
function setProxy(options, proxy, location) {
  options.hostname = proxy.host;
  options.host = proxy.host;
  options.port = proxy.port;
  options.path = location;

  // Basic proxy authorization
  if (proxy.auth) {
    var base64 = Buffer.from(proxy.auth.username + ':' + proxy.auth.password, 'utf8').toString('base64');
    options.headers['Proxy-Authorization'] = 'Basic ' + base64;
  }

  // If a proxy is used, any redirects must also pass through the proxy
  options.beforeRedirect = function beforeRedirect(redirection) {
    redirection.headers.host = redirection.host;
    setProxy(redirection, proxy, redirection.href);
  };
}

/*eslint consistent-return:0*/
var http_1 = function httpAdapter(config) {
  return new Promise(function dispatchHttpRequest(resolvePromise, rejectPromise) {
    var onCanceled;
    function done() {
      if (config.cancelToken) {
        config.cancelToken.unsubscribe(onCanceled);
      }

      if (config.signal) {
        config.signal.removeEventListener('abort', onCanceled);
      }
    }
    var resolve = function resolve(value) {
      done();
      resolvePromise(value);
    };
    var rejected = false;
    var reject = function reject(value) {
      done();
      rejected = true;
      rejectPromise(value);
    };
    var data = config.data;
    var headers = config.headers;
    var headerNames = {};

    Object.keys(headers).forEach(function storeLowerName(name) {
      headerNames[name.toLowerCase()] = name;
    });

    // Set User-Agent (required by some servers)
    // See https://github.com/axios/axios/issues/69
    if ('user-agent' in headerNames) {
      // User-Agent is specified; handle case where no UA header is desired
      if (!headers[headerNames['user-agent']]) {
        delete headers[headerNames['user-agent']];
      }
      // Otherwise, use specified value
    } else {
      // Only set header if it hasn't been set in config
      headers['User-Agent'] = 'axios/' + VERSION$1;
    }

    if (data && !utils.isStream(data)) {
      if (Buffer.isBuffer(data)) ; else if (utils.isArrayBuffer(data)) {
        data = Buffer.from(new Uint8Array(data));
      } else if (utils.isString(data)) {
        data = Buffer.from(data, 'utf-8');
      } else {
        return reject(createError(
          'Data after transformation must be a string, an ArrayBuffer, a Buffer, or a Stream',
          config
        ));
      }

      if (config.maxBodyLength > -1 && data.length > config.maxBodyLength) {
        return reject(createError('Request body larger than maxBodyLength limit', config));
      }

      // Add Content-Length header if data exists
      if (!headerNames['content-length']) {
        headers['Content-Length'] = data.length;
      }
    }

    // HTTP basic authentication
    var auth = undefined;
    if (config.auth) {
      var username = config.auth.username || '';
      var password = config.auth.password || '';
      auth = username + ':' + password;
    }

    // Parse url
    var fullPath = buildFullPath(config.baseURL, config.url);
    var parsed = url.parse(fullPath);
    var protocol = parsed.protocol || 'http:';

    if (!auth && parsed.auth) {
      var urlAuth = parsed.auth.split(':');
      var urlUsername = urlAuth[0] || '';
      var urlPassword = urlAuth[1] || '';
      auth = urlUsername + ':' + urlPassword;
    }

    if (auth && headerNames.authorization) {
      delete headers[headerNames.authorization];
    }

    var isHttpsRequest = isHttps$1.test(protocol);
    var agent = isHttpsRequest ? config.httpsAgent : config.httpAgent;

    try {
      buildURL(parsed.path, config.params, config.paramsSerializer).replace(/^\?/, '');
    } catch (err) {
      var customErr = new Error(err.message);
      customErr.config = config;
      customErr.url = config.url;
      customErr.exists = true;
      reject(customErr);
    }

    var options = {
      path: buildURL(parsed.path, config.params, config.paramsSerializer).replace(/^\?/, ''),
      method: config.method.toUpperCase(),
      headers: headers,
      agent: agent,
      agents: { http: config.httpAgent, https: config.httpsAgent },
      auth: auth
    };

    if (config.socketPath) {
      options.socketPath = config.socketPath;
    } else {
      options.hostname = parsed.hostname;
      options.port = parsed.port;
    }

    var proxy = config.proxy;
    if (!proxy && proxy !== false) {
      var proxyEnv = protocol.slice(0, -1) + '_proxy';
      var proxyUrl = process.env[proxyEnv] || process.env[proxyEnv.toUpperCase()];
      if (proxyUrl) {
        var parsedProxyUrl = url.parse(proxyUrl);
        var noProxyEnv = process.env.no_proxy || process.env.NO_PROXY;
        var shouldProxy = true;

        if (noProxyEnv) {
          var noProxy = noProxyEnv.split(',').map(function trim(s) {
            return s.trim();
          });

          shouldProxy = !noProxy.some(function proxyMatch(proxyElement) {
            if (!proxyElement) {
              return false;
            }
            if (proxyElement === '*') {
              return true;
            }
            if (proxyElement[0] === '.' &&
                parsed.hostname.substr(parsed.hostname.length - proxyElement.length) === proxyElement) {
              return true;
            }

            return parsed.hostname === proxyElement;
          });
        }

        if (shouldProxy) {
          proxy = {
            host: parsedProxyUrl.hostname,
            port: parsedProxyUrl.port,
            protocol: parsedProxyUrl.protocol
          };

          if (parsedProxyUrl.auth) {
            var proxyUrlAuth = parsedProxyUrl.auth.split(':');
            proxy.auth = {
              username: proxyUrlAuth[0],
              password: proxyUrlAuth[1]
            };
          }
        }
      }
    }

    if (proxy) {
      options.headers.host = parsed.hostname + (parsed.port ? ':' + parsed.port : '');
      setProxy(options, proxy, protocol + '//' + parsed.hostname + (parsed.port ? ':' + parsed.port : '') + options.path);
    }

    var transport;
    var isHttpsProxy = isHttpsRequest && (proxy ? isHttps$1.test(proxy.protocol) : true);
    if (config.transport) {
      transport = config.transport;
    } else if (config.maxRedirects === 0) {
      transport = isHttpsProxy ? https : http$1;
    } else {
      if (config.maxRedirects) {
        options.maxRedirects = config.maxRedirects;
      }
      transport = isHttpsProxy ? httpsFollow : httpFollow;
    }

    if (config.maxBodyLength > -1) {
      options.maxBodyLength = config.maxBodyLength;
    }

    if (config.insecureHTTPParser) {
      options.insecureHTTPParser = config.insecureHTTPParser;
    }

    // Create the request
    var req = transport.request(options, function handleResponse(res) {
      if (req.aborted) return;

      // uncompress the response body transparently if required
      var stream = res;

      // return the last request in case of redirects
      var lastRequest = res.req || req;


      // if no content, is HEAD request or decompress disabled we should not decompress
      if (res.statusCode !== 204 && lastRequest.method !== 'HEAD' && config.decompress !== false) {
        switch (res.headers['content-encoding']) {
        /*eslint default-case:0*/
        case 'gzip':
        case 'compress':
        case 'deflate':
        // add the unzipper to the body stream processing pipeline
          stream = stream.pipe(zlib.createUnzip());

          // remove the content-encoding in order to not confuse downstream operations
          delete res.headers['content-encoding'];
          break;
        }
      }

      var response = {
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: res.headers,
        config: config,
        request: lastRequest
      };

      if (config.responseType === 'stream') {
        response.data = stream;
        settle(resolve, reject, response);
      } else {
        var responseBuffer = [];
        var totalResponseBytes = 0;
        stream.on('data', function handleStreamData(chunk) {
          responseBuffer.push(chunk);
          totalResponseBytes += chunk.length;

          // make sure the content length is not over the maxContentLength if specified
          if (config.maxContentLength > -1 && totalResponseBytes > config.maxContentLength) {
            // stream.destoy() emit aborted event before calling reject() on Node.js v16
            rejected = true;
            stream.destroy();
            reject(createError('maxContentLength size of ' + config.maxContentLength + ' exceeded',
              config, null, lastRequest));
          }
        });

        stream.on('aborted', function handlerStreamAborted() {
          if (rejected) {
            return;
          }
          stream.destroy();
          reject(createError('error request aborted', config, 'ERR_REQUEST_ABORTED', lastRequest));
        });

        stream.on('error', function handleStreamError(err) {
          if (req.aborted) return;
          reject(enhanceError(err, config, null, lastRequest));
        });

        stream.on('end', function handleStreamEnd() {
          try {
            var responseData = responseBuffer.length === 1 ? responseBuffer[0] : Buffer.concat(responseBuffer);
            if (config.responseType !== 'arraybuffer') {
              responseData = responseData.toString(config.responseEncoding);
              if (!config.responseEncoding || config.responseEncoding === 'utf8') {
                responseData = utils.stripBOM(responseData);
              }
            }
            response.data = responseData;
          } catch (err) {
            reject(enhanceError(err, config, err.code, response.request, response));
          }
          settle(resolve, reject, response);
        });
      }
    });

    // Handle errors
    req.on('error', function handleRequestError(err) {
      if (req.aborted && err.code !== 'ERR_FR_TOO_MANY_REDIRECTS') return;
      reject(enhanceError(err, config, null, req));
    });

    // set tcp keep alive to prevent drop connection by peer
    req.on('socket', function handleRequestSocket(socket) {
      // default interval of sending ack packet is 1 minute
      socket.setKeepAlive(true, 1000 * 60);
    });

    // Handle request timeout
    if (config.timeout) {
      // This is forcing a int timeout to avoid problems if the `req` interface doesn't handle other types.
      var timeout = parseInt(config.timeout, 10);

      if (isNaN(timeout)) {
        reject(createError(
          'error trying to parse `config.timeout` to int',
          config,
          'ERR_PARSE_TIMEOUT',
          req
        ));

        return;
      }

      // Sometime, the response will be very slow, and does not respond, the connect event will be block by event loop system.
      // And timer callback will be fired, and abort() will be invoked before connection, then get "socket hang up" and code ECONNRESET.
      // At this time, if we have a large number of request, nodejs will hang up some socket on background. and the number will up and up.
      // And then these socket which be hang up will devoring CPU little by little.
      // ClientRequest.setTimeout will be fired on the specify milliseconds, and can make sure that abort() will be fired after connect.
      req.setTimeout(timeout, function handleRequestTimeout() {
        req.abort();
        var timeoutErrorMessage = '';
        if (config.timeoutErrorMessage) {
          timeoutErrorMessage = config.timeoutErrorMessage;
        } else {
          timeoutErrorMessage = 'timeout of ' + config.timeout + 'ms exceeded';
        }
        var transitional = config.transitional || defaults$1.transitional;
        reject(createError(
          timeoutErrorMessage,
          config,
          transitional.clarifyTimeoutError ? 'ETIMEDOUT' : 'ECONNABORTED',
          req
        ));
      });
    }

    if (config.cancelToken || config.signal) {
      // Handle cancellation
      // eslint-disable-next-line func-names
      onCanceled = function(cancel) {
        if (req.aborted) return;

        req.abort();
        reject(!cancel || (cancel && cancel.type) ? new Cancel_1('canceled') : cancel);
      };

      config.cancelToken && config.cancelToken.subscribe(onCanceled);
      if (config.signal) {
        config.signal.aborted ? onCanceled() : config.signal.addEventListener('abort', onCanceled);
      }
    }


    // Send the request
    if (utils.isStream(data)) {
      data.on('error', function handleStreamError(err) {
        reject(enhanceError(err, config, null, req));
      }).pipe(req);
    } else {
      req.end(data);
    }
  });
};

var DEFAULT_CONTENT_TYPE = {
  'Content-Type': 'application/x-www-form-urlencoded'
};

function setContentTypeIfUnset(headers, value) {
  if (!utils.isUndefined(headers) && utils.isUndefined(headers['Content-Type'])) {
    headers['Content-Type'] = value;
  }
}

function getDefaultAdapter() {
  var adapter;
  if (typeof XMLHttpRequest !== 'undefined') {
    // For browsers use XHR adapter
    adapter = xhr;
  } else if (typeof process !== 'undefined' && Object.prototype.toString.call(process) === '[object process]') {
    // For node use HTTP adapter
    adapter = http_1;
  }
  return adapter;
}

function stringifySafely(rawValue, parser, encoder) {
  if (utils.isString(rawValue)) {
    try {
      (parser || JSON.parse)(rawValue);
      return utils.trim(rawValue);
    } catch (e) {
      if (e.name !== 'SyntaxError') {
        throw e;
      }
    }
  }

  return (encoder || JSON.stringify)(rawValue);
}

var defaults = {

  transitional: {
    silentJSONParsing: true,
    forcedJSONParsing: true,
    clarifyTimeoutError: false
  },

  adapter: getDefaultAdapter(),

  transformRequest: [function transformRequest(data, headers) {
    normalizeHeaderName(headers, 'Accept');
    normalizeHeaderName(headers, 'Content-Type');

    if (utils.isFormData(data) ||
      utils.isArrayBuffer(data) ||
      utils.isBuffer(data) ||
      utils.isStream(data) ||
      utils.isFile(data) ||
      utils.isBlob(data)
    ) {
      return data;
    }
    if (utils.isArrayBufferView(data)) {
      return data.buffer;
    }
    if (utils.isURLSearchParams(data)) {
      setContentTypeIfUnset(headers, 'application/x-www-form-urlencoded;charset=utf-8');
      return data.toString();
    }
    if (utils.isObject(data) || (headers && headers['Content-Type'] === 'application/json')) {
      setContentTypeIfUnset(headers, 'application/json');
      return stringifySafely(data);
    }
    return data;
  }],

  transformResponse: [function transformResponse(data) {
    var transitional = this.transitional || defaults.transitional;
    var silentJSONParsing = transitional && transitional.silentJSONParsing;
    var forcedJSONParsing = transitional && transitional.forcedJSONParsing;
    var strictJSONParsing = !silentJSONParsing && this.responseType === 'json';

    if (strictJSONParsing || (forcedJSONParsing && utils.isString(data) && data.length)) {
      try {
        return JSON.parse(data);
      } catch (e) {
        if (strictJSONParsing) {
          if (e.name === 'SyntaxError') {
            throw enhanceError(e, this, 'E_JSON_PARSE');
          }
          throw e;
        }
      }
    }

    return data;
  }],

  /**
   * A timeout in milliseconds to abort a request. If set to 0 (default) a
   * timeout is not created.
   */
  timeout: 0,

  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',

  maxContentLength: -1,
  maxBodyLength: -1,

  validateStatus: function validateStatus(status) {
    return status >= 200 && status < 300;
  },

  headers: {
    common: {
      'Accept': 'application/json, text/plain, */*'
    }
  }
};

utils.forEach(['delete', 'get', 'head'], function forEachMethodNoData(method) {
  defaults.headers[method] = {};
});

utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
  defaults.headers[method] = utils.merge(DEFAULT_CONTENT_TYPE);
});

var defaults_1 = defaults;

/**
 * Transform the data for a request or a response
 *
 * @param {Object|String} data The data to be transformed
 * @param {Array} headers The headers for the request or response
 * @param {Array|Function} fns A single function or Array of functions
 * @returns {*} The resulting transformed data
 */
var transformData = function transformData(data, headers, fns) {
  var context = this || defaults$1;
  /*eslint no-param-reassign:0*/
  utils.forEach(fns, function transform(fn) {
    data = fn.call(context, data, headers);
  });

  return data;
};

var isCancel = function isCancel(value) {
  return !!(value && value.__CANCEL__);
};

/**
 * Throws a `Cancel` if cancellation has been requested.
 */
function throwIfCancellationRequested(config) {
  if (config.cancelToken) {
    config.cancelToken.throwIfRequested();
  }

  if (config.signal && config.signal.aborted) {
    throw new Cancel_1('canceled');
  }
}

/**
 * Dispatch a request to the server using the configured adapter.
 *
 * @param {object} config The config that is to be used for the request
 * @returns {Promise} The Promise to be fulfilled
 */
var dispatchRequest = function dispatchRequest(config) {
  throwIfCancellationRequested(config);

  // Ensure headers exist
  config.headers = config.headers || {};

  // Transform request data
  config.data = transformData.call(
    config,
    config.data,
    config.headers,
    config.transformRequest
  );

  // Flatten headers
  config.headers = utils.merge(
    config.headers.common || {},
    config.headers[config.method] || {},
    config.headers
  );

  utils.forEach(
    ['delete', 'get', 'head', 'post', 'put', 'patch', 'common'],
    function cleanHeaderConfig(method) {
      delete config.headers[method];
    }
  );

  var adapter = config.adapter || defaults$1.adapter;

  return adapter(config).then(function onAdapterResolution(response) {
    throwIfCancellationRequested(config);

    // Transform response data
    response.data = transformData.call(
      config,
      response.data,
      response.headers,
      config.transformResponse
    );

    return response;
  }, function onAdapterRejection(reason) {
    if (!isCancel(reason)) {
      throwIfCancellationRequested(config);

      // Transform response data
      if (reason && reason.response) {
        reason.response.data = transformData.call(
          config,
          reason.response.data,
          reason.response.headers,
          config.transformResponse
        );
      }
    }

    return Promise.reject(reason);
  });
};

/**
 * Config-specific merge-function which creates a new config-object
 * by merging two configuration objects together.
 *
 * @param {Object} config1
 * @param {Object} config2
 * @returns {Object} New object resulting from merging config2 to config1
 */
var mergeConfig = function mergeConfig(config1, config2) {
  // eslint-disable-next-line no-param-reassign
  config2 = config2 || {};
  var config = {};

  function getMergedValue(target, source) {
    if (utils.isPlainObject(target) && utils.isPlainObject(source)) {
      return utils.merge(target, source);
    } else if (utils.isPlainObject(source)) {
      return utils.merge({}, source);
    } else if (utils.isArray(source)) {
      return source.slice();
    }
    return source;
  }

  // eslint-disable-next-line consistent-return
  function mergeDeepProperties(prop) {
    if (!utils.isUndefined(config2[prop])) {
      return getMergedValue(config1[prop], config2[prop]);
    } else if (!utils.isUndefined(config1[prop])) {
      return getMergedValue(undefined, config1[prop]);
    }
  }

  // eslint-disable-next-line consistent-return
  function valueFromConfig2(prop) {
    if (!utils.isUndefined(config2[prop])) {
      return getMergedValue(undefined, config2[prop]);
    }
  }

  // eslint-disable-next-line consistent-return
  function defaultToConfig2(prop) {
    if (!utils.isUndefined(config2[prop])) {
      return getMergedValue(undefined, config2[prop]);
    } else if (!utils.isUndefined(config1[prop])) {
      return getMergedValue(undefined, config1[prop]);
    }
  }

  // eslint-disable-next-line consistent-return
  function mergeDirectKeys(prop) {
    if (prop in config2) {
      return getMergedValue(config1[prop], config2[prop]);
    } else if (prop in config1) {
      return getMergedValue(undefined, config1[prop]);
    }
  }

  var mergeMap = {
    'url': valueFromConfig2,
    'method': valueFromConfig2,
    'data': valueFromConfig2,
    'baseURL': defaultToConfig2,
    'transformRequest': defaultToConfig2,
    'transformResponse': defaultToConfig2,
    'paramsSerializer': defaultToConfig2,
    'timeout': defaultToConfig2,
    'timeoutMessage': defaultToConfig2,
    'withCredentials': defaultToConfig2,
    'adapter': defaultToConfig2,
    'responseType': defaultToConfig2,
    'xsrfCookieName': defaultToConfig2,
    'xsrfHeaderName': defaultToConfig2,
    'onUploadProgress': defaultToConfig2,
    'onDownloadProgress': defaultToConfig2,
    'decompress': defaultToConfig2,
    'maxContentLength': defaultToConfig2,
    'maxBodyLength': defaultToConfig2,
    'transport': defaultToConfig2,
    'httpAgent': defaultToConfig2,
    'httpsAgent': defaultToConfig2,
    'cancelToken': defaultToConfig2,
    'socketPath': defaultToConfig2,
    'responseEncoding': defaultToConfig2,
    'validateStatus': mergeDirectKeys
  };

  utils.forEach(Object.keys(config1).concat(Object.keys(config2)), function computeConfigValue(prop) {
    var merge = mergeMap[prop] || mergeDeepProperties;
    var configValue = merge(prop);
    (utils.isUndefined(configValue) && merge !== mergeDirectKeys) || (config[prop] = configValue);
  });

  return config;
};

var VERSION = data.version;

var validators$1 = {};

// eslint-disable-next-line func-names
['object', 'boolean', 'number', 'function', 'string', 'symbol'].forEach(function(type, i) {
  validators$1[type] = function validator(thing) {
    return typeof thing === type || 'a' + (i < 1 ? 'n ' : ' ') + type;
  };
});

var deprecatedWarnings = {};

/**
 * Transitional option validator
 * @param {function|boolean?} validator - set to false if the transitional option has been removed
 * @param {string?} version - deprecated version / removed since version
 * @param {string?} message - some message with additional info
 * @returns {function}
 */
validators$1.transitional = function transitional(validator, version, message) {
  function formatMessage(opt, desc) {
    return '[Axios v' + VERSION + '] Transitional option \'' + opt + '\'' + desc + (message ? '. ' + message : '');
  }

  // eslint-disable-next-line func-names
  return function(value, opt, opts) {
    if (validator === false) {
      throw new Error(formatMessage(opt, ' has been removed' + (version ? ' in ' + version : '')));
    }

    if (version && !deprecatedWarnings[opt]) {
      deprecatedWarnings[opt] = true;
      // eslint-disable-next-line no-console
      console.warn(
        formatMessage(
          opt,
          ' has been deprecated since v' + version + ' and will be removed in the near future'
        )
      );
    }

    return validator ? validator(value, opt, opts) : true;
  };
};

/**
 * Assert object's properties type
 * @param {object} options
 * @param {object} schema
 * @param {boolean?} allowUnknown
 */

function assertOptions(options, schema, allowUnknown) {
  if (typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  var keys = Object.keys(options);
  var i = keys.length;
  while (i-- > 0) {
    var opt = keys[i];
    var validator = schema[opt];
    if (validator) {
      var value = options[opt];
      var result = value === undefined || validator(value, opt, options);
      if (result !== true) {
        throw new TypeError('option ' + opt + ' must be ' + result);
      }
      continue;
    }
    if (allowUnknown !== true) {
      throw Error('Unknown option ' + opt);
    }
  }
}

var validator = {
  assertOptions: assertOptions,
  validators: validators$1
};

var validators = validator.validators;
/**
 * Create a new instance of Axios
 *
 * @param {Object} instanceConfig The default config for the instance
 */
function Axios(instanceConfig) {
  this.defaults = instanceConfig;
  this.interceptors = {
    request: new InterceptorManager_1(),
    response: new InterceptorManager_1()
  };
}

/**
 * Dispatch a request
 *
 * @param {Object} config The config specific for this request (merged with this.defaults)
 */
Axios.prototype.request = function request(configOrUrl, config) {
  /*eslint no-param-reassign:0*/
  // Allow for axios('example/url'[, config]) a la fetch API
  if (typeof configOrUrl === 'string') {
    config = config || {};
    config.url = configOrUrl;
  } else {
    config = configOrUrl || {};
  }

  config = mergeConfig(this.defaults, config);

  // Set config.method
  if (config.method) {
    config.method = config.method.toLowerCase();
  } else if (this.defaults.method) {
    config.method = this.defaults.method.toLowerCase();
  } else {
    config.method = 'get';
  }

  var transitional = config.transitional;

  if (transitional !== undefined) {
    validator.assertOptions(transitional, {
      silentJSONParsing: validators.transitional(validators.boolean),
      forcedJSONParsing: validators.transitional(validators.boolean),
      clarifyTimeoutError: validators.transitional(validators.boolean)
    }, false);
  }

  // filter out skipped interceptors
  var requestInterceptorChain = [];
  var synchronousRequestInterceptors = true;
  this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
    if (typeof interceptor.runWhen === 'function' && interceptor.runWhen(config) === false) {
      return;
    }

    synchronousRequestInterceptors = synchronousRequestInterceptors && interceptor.synchronous;

    requestInterceptorChain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  var responseInterceptorChain = [];
  this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
    responseInterceptorChain.push(interceptor.fulfilled, interceptor.rejected);
  });

  var promise;

  if (!synchronousRequestInterceptors) {
    var chain = [dispatchRequest, undefined];

    Array.prototype.unshift.apply(chain, requestInterceptorChain);
    chain = chain.concat(responseInterceptorChain);

    promise = Promise.resolve(config);
    while (chain.length) {
      promise = promise.then(chain.shift(), chain.shift());
    }

    return promise;
  }


  var newConfig = config;
  while (requestInterceptorChain.length) {
    var onFulfilled = requestInterceptorChain.shift();
    var onRejected = requestInterceptorChain.shift();
    try {
      newConfig = onFulfilled(newConfig);
    } catch (error) {
      onRejected(error);
      break;
    }
  }

  try {
    promise = dispatchRequest(newConfig);
  } catch (error) {
    return Promise.reject(error);
  }

  while (responseInterceptorChain.length) {
    promise = promise.then(responseInterceptorChain.shift(), responseInterceptorChain.shift());
  }

  return promise;
};

Axios.prototype.getUri = function getUri(config) {
  config = mergeConfig(this.defaults, config);
  return buildURL(config.url, config.params, config.paramsSerializer).replace(/^\?/, '');
};

// Provide aliases for supported request methods
utils.forEach(['delete', 'get', 'head', 'options'], function forEachMethodNoData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: (config || {}).data
    }));
  };
});

utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
  /*eslint func-names:0*/
  Axios.prototype[method] = function(url, data, config) {
    return this.request(mergeConfig(config || {}, {
      method: method,
      url: url,
      data: data
    }));
  };
});

var Axios_1 = Axios;

/**
 * A `CancelToken` is an object that can be used to request cancellation of an operation.
 *
 * @class
 * @param {Function} executor The executor function.
 */
function CancelToken(executor) {
  if (typeof executor !== 'function') {
    throw new TypeError('executor must be a function.');
  }

  var resolvePromise;

  this.promise = new Promise(function promiseExecutor(resolve) {
    resolvePromise = resolve;
  });

  var token = this;

  // eslint-disable-next-line func-names
  this.promise.then(function(cancel) {
    if (!token._listeners) return;

    var i;
    var l = token._listeners.length;

    for (i = 0; i < l; i++) {
      token._listeners[i](cancel);
    }
    token._listeners = null;
  });

  // eslint-disable-next-line func-names
  this.promise.then = function(onfulfilled) {
    var _resolve;
    // eslint-disable-next-line func-names
    var promise = new Promise(function(resolve) {
      token.subscribe(resolve);
      _resolve = resolve;
    }).then(onfulfilled);

    promise.cancel = function reject() {
      token.unsubscribe(_resolve);
    };

    return promise;
  };

  executor(function cancel(message) {
    if (token.reason) {
      // Cancellation has already been requested
      return;
    }

    token.reason = new Cancel_1(message);
    resolvePromise(token.reason);
  });
}

/**
 * Throws a `Cancel` if cancellation has been requested.
 */
CancelToken.prototype.throwIfRequested = function throwIfRequested() {
  if (this.reason) {
    throw this.reason;
  }
};

/**
 * Subscribe to the cancel signal
 */

CancelToken.prototype.subscribe = function subscribe(listener) {
  if (this.reason) {
    listener(this.reason);
    return;
  }

  if (this._listeners) {
    this._listeners.push(listener);
  } else {
    this._listeners = [listener];
  }
};

/**
 * Unsubscribe from the cancel signal
 */

CancelToken.prototype.unsubscribe = function unsubscribe(listener) {
  if (!this._listeners) {
    return;
  }
  var index = this._listeners.indexOf(listener);
  if (index !== -1) {
    this._listeners.splice(index, 1);
  }
};

/**
 * Returns an object that contains a new `CancelToken` and a function that, when called,
 * cancels the `CancelToken`.
 */
CancelToken.source = function source() {
  var cancel;
  var token = new CancelToken(function executor(c) {
    cancel = c;
  });
  return {
    token: token,
    cancel: cancel
  };
};

var CancelToken_1 = CancelToken;

/**
 * Syntactic sugar for invoking a function and expanding an array for arguments.
 *
 * Common use case would be to use `Function.prototype.apply`.
 *
 *  ```js
 *  function f(x, y, z) {}
 *  var args = [1, 2, 3];
 *  f.apply(null, args);
 *  ```
 *
 * With `spread` this example can be re-written.
 *
 *  ```js
 *  spread(function(x, y, z) {})([1, 2, 3]);
 *  ```
 *
 * @param {Function} callback
 * @returns {Function}
 */
var spread = function spread(callback) {
  return function wrap(arr) {
    return callback.apply(null, arr);
  };
};

/**
 * Determines whether the payload is an error thrown by Axios
 *
 * @param {*} payload The value to test
 * @returns {boolean} True if the payload is an error thrown by Axios, otherwise false
 */
var isAxiosError = function isAxiosError(payload) {
  return utils.isObject(payload) && (payload.isAxiosError === true);
};

/**
 * Create an instance of Axios
 *
 * @param {Object} defaultConfig The default config for the instance
 * @return {Axios} A new instance of Axios
 */
function createInstance(defaultConfig) {
  var context = new Axios_1(defaultConfig);
  var instance = bind(Axios_1.prototype.request, context);

  // Copy axios.prototype to instance
  utils.extend(instance, Axios_1.prototype, context);

  // Copy context to instance
  utils.extend(instance, context);

  // Factory for creating new instances
  instance.create = function create(instanceConfig) {
    return createInstance(mergeConfig(defaultConfig, instanceConfig));
  };

  return instance;
}

// Create the default instance to be exported
var axios$1 = createInstance(defaults$1);

// Expose Axios class to allow class inheritance
axios$1.Axios = Axios_1;

// Expose Cancel & CancelToken
axios$1.Cancel = Cancel_1;
axios$1.CancelToken = CancelToken_1;
axios$1.isCancel = isCancel;
axios$1.VERSION = data.version;

// Expose all/spread
axios$1.all = function all(promises) {
  return Promise.all(promises);
};
axios$1.spread = spread;

// Expose isAxiosError
axios$1.isAxiosError = isAxiosError;

var axios_1 = axios$1;

// Allow use of default import syntax in TypeScript
var default_1 = axios$1;
axios_1.default = default_1;

var axios = axios_1;

const ALPHABET_SIZE = 26;
const WHITESPACE_CHARS = " \t\v\f\uFEFF\n\r\u2028\u2029";

// basic
const equals = (s1, s2, ignoreCase) => {
  if (ignoreCase) {
    return s1.toLowerCase() === s2.toLowerCase();
  }
  return s1 === s2;
};
const contains = (s, searchString, ignoreCase) => {
  if (ignoreCase) {
    return s.toLowerCase().indexOf(searchString.toLowerCase()) !== -1;
  }
  return s.indexOf(searchString) !== -1;
};
const startsWith = (s, searchString, ignoreCase) => {
  if (ignoreCase) {
    return s.toLowerCase().indexOf(searchString.toLowerCase()) === 0;
  }
  return s.indexOf(searchString) === 0;
};
const endsWith = (s, searchString, ignoreCase) => {
  if (ignoreCase) {
    return (
      s
        .toLowerCase()
        .indexOf(searchString.toLowerCase(), s.length - searchString.length) !==
      -1
    );
  }
  return s.indexOf(searchString, s.length - searchString.length) !== -1;
};
const trimLeft = (s, chars = WHITESPACE_CHARS) => {
  let s2 = "" + s;
  for (let i = 0; i < s.length; i++) {
    if (chars.includes(s[i])) {
      s2 = s2.substring(1);
    } else {
      return s2;
    }
  }
  return s2;
};
const trimRight = (s, chars = WHITESPACE_CHARS) => {
  let s2 = "" + s;
  for (let i = s.length - 1; i >= 0; i--) {
    if (chars.includes(s[i])) {
      s2 = s2.substring(0, i);
    } else {
      return s2;
    }
  }
  return s2;
};
const trim = (s, chars = WHITESPACE_CHARS) => {
  if (chars == null) {
    return s.trim();
  }
  return trimRight(trimLeft(s, chars), chars);
};
const replaceAll = (s, find, replace) => {
  return s.replace(new RegExp(find, "g"), replace);
};

// generating
const randomize = (length = 10) => {
  return [...Array(length)]
    .map(() => Math.floor(Math.random() * (10 + ALPHABET_SIZE * 2))) // include uppercase
    .map(x =>
      x > 10 + ALPHABET_SIZE
        ? (x - ALPHABET_SIZE).toString(36).toUpperCase()
        : x.toString(36)
    )
    .join("");
};
const newGuid = () => {
  const s = randomize(32);
  return `${s.substr(0, 8)}-${s.substr(8, 4)}-${s.substr(12, 4)}-${s.substr(
    16,
    4
  )}-${s.substr(20, 12)}`;
};

// validation
// consider using https://github.com/validatorjs/validator.js
const isEmail = email => {
  // https://stackoverflow.com/questions/16800540/validate-email-address-in-dart#answer-16888554
  return /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(
    email
  );
};
const isUrl = url => {
  // https://www.regextester.com/94502
  return /^(?:http(s)?:\/\/)?[\w.-]+(?:\.[\w.-]+)+[\w\-._~:/?#[\]@!$&'()*+,;=.]+$/gi.test(
    url
  );
};

// formatters
const formatBelgianPhone = phone => {
  if (typeof phone !== "string") {
    return "";
  }

  if (phone.length === 12 && phone.indexOf("00323") === 0) {
    const s = phone.match(/(\d{4})(\d{1})(\d{3})(\d{2})(\d{2})/);
    if (s.length == 6) {
      return `+${s[1].substr(2)} ${s[2]} ${s[3]} ${s[4]} ${s[5]}`;
    }
  } else if (phone.length === 13 && phone.indexOf("00324") === 0) {
    const s = phone.match(/(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/);
    if (s.length == 6) {
      return `+${s[1].substr(2)} ${s[2]} ${s[3]} ${s[4]} ${s[5]}`;
    }
  }
  return phone;
};

const htmlEncode = s => {
  // https://stackoverflow.com/questions/36858774/how-to-replace-html-special-character-in-javascript#answer-36858867
  return s.replace(/[\u00A0-\u9999<>&]/gim, i => "&#" + i.charCodeAt(0) + ";");
};
const htmlDecode = s => {
  return s.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
  // https://stackoverflow.com/questions/3700326/decode-amp-back-to-in-javascript#answer-42254787
  // return typeof (DOMParser) === 'function'
  // 	? new DOMParser().parseFromString(`<!doctype html><body>${s}`, 'text/html').body.textContent
  // 	: s.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
};
// -> use _.deburr() instead
// replaces special characters to their equivalent simple characters (e.g. é -> e)
const normalizeDiacritics = s => {
  // https://stackoverflow.com/questions/3939266/javascript-function-to-remove-diacritics#answer-5960592
  const defaultDiacriticsRemovalMap = [
    {
      base: "A",
      letters: /[\u0041\u24B6\uFF21\u00C0\u00C1\u00C2\u1EA6\u1EA4\u1EAA\u1EA8\u00C3\u0100\u0102\u1EB0\u1EAE\u1EB4\u1EB2\u0226\u01E0\u00C4\u01DE\u1EA2\u00C5\u01FA\u01CD\u0200\u0202\u1EA0\u1EAC\u1EB6\u1E00\u0104\u023A\u2C6F]/g
    },
    { base: "AA", letters: /[\uA732]/g },
    { base: "AE", letters: /[\u00C6\u01FC\u01E2]/g },
    { base: "AO", letters: /[\uA734]/g },
    { base: "AU", letters: /[\uA736]/g },
    { base: "AV", letters: /[\uA738\uA73A]/g },
    { base: "AY", letters: /[\uA73C]/g },
    {
      base: "B",
      letters: /[\u0042\u24B7\uFF22\u1E02\u1E04\u1E06\u0243\u0182\u0181]/g
    },
    {
      base: "C",
      letters: /[\u0043\u24B8\uFF23\u0106\u0108\u010A\u010C\u00C7\u1E08\u0187\u023B\uA73E]/g
    },
    {
      base: "D",
      letters: /[\u0044\u24B9\uFF24\u1E0A\u010E\u1E0C\u1E10\u1E12\u1E0E\u0110\u018B\u018A\u0189\uA779]/g
    },
    { base: "DZ", letters: /[\u01F1\u01C4]/g },
    { base: "Dz", letters: /[\u01F2\u01C5]/g },
    {
      base: "E",
      letters: /[\u0045\u24BA\uFF25\u00C8\u00C9\u00CA\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u0112\u1E14\u1E16\u0114\u0116\u00CB\u1EBA\u011A\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u0118\u1E18\u1E1A\u0190\u018E]/g
    },
    { base: "F", letters: /[\u0046\u24BB\uFF26\u1E1E\u0191\uA77B]/g },
    {
      base: "G",
      letters: /[\u0047\u24BC\uFF27\u01F4\u011C\u1E20\u011E\u0120\u01E6\u0122\u01E4\u0193\uA7A0\uA77D\uA77E]/g
    },
    {
      base: "H",
      letters: /[\u0048\u24BD\uFF28\u0124\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u2C75\uA78D]/g
    },
    {
      base: "I",
      letters: /[\u0049\u24BE\uFF29\u00CC\u00CD\u00CE\u0128\u012A\u012C\u0130\u00CF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197]/g
    },
    { base: "J", letters: /[\u004A\u24BF\uFF2A\u0134\u0248]/g },
    {
      base: "K",
      letters: /[\u004B\u24C0\uFF2B\u1E30\u01E8\u1E32\u0136\u1E34\u0198\u2C69\uA740\uA742\uA744\uA7A2]/g
    },
    {
      base: "L",
      letters: /[\u004C\u24C1\uFF2C\u013F\u0139\u013D\u1E36\u1E38\u013B\u1E3C\u1E3A\u0141\u023D\u2C62\u2C60\uA748\uA746\uA780]/g
    },
    { base: "LJ", letters: /[\u01C7]/g },
    { base: "Lj", letters: /[\u01C8]/g },
    {
      base: "M",
      letters: /[\u004D\u24C2\uFF2D\u1E3E\u1E40\u1E42\u2C6E\u019C]/g
    },
    {
      base: "N",
      letters: /[\u004E\u24C3\uFF2E\u01F8\u0143\u00D1\u1E44\u0147\u1E46\u0145\u1E4A\u1E48\u0220\u019D\uA790\uA7A4]/g
    },
    { base: "NJ", letters: /[\u01CA]/g },
    { base: "Nj", letters: /[\u01CB]/g },
    {
      base: "O",
      letters: /[\u004F\u24C4\uFF2F\u00D2\u00D3\u00D4\u1ED2\u1ED0\u1ED6\u1ED4\u00D5\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u014E\u022E\u0230\u00D6\u022A\u1ECE\u0150\u01D1\u020C\u020E\u01A0\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\u00D8\u01FE\u0186\u019F\uA74A\uA74C]/g
    },
    { base: "OE", letters: /[\u0152\u0276]/g },
    { base: "OI", letters: /[\u01A2]/g },
    { base: "OO", letters: /[\uA74E]/g },
    { base: "OU", letters: /[\u0222]/g },
    {
      base: "P",
      letters: /[\u0050\u24C5\uFF30\u1E54\u1E56\u01A4\u2C63\uA750\uA752\uA754]/g
    },
    { base: "Q", letters: /[\u0051\u24C6\uFF31\uA756\uA758\u024A]/g },
    {
      base: "R",
      letters: /[\u0052\u24C7\uFF32\u0154\u1E58\u0158\u0210\u0212\u1E5A\u1E5C\u0156\u1E5E\u024C\u2C64\uA75A\uA7A6\uA782]/g
    },
    {
      base: "S",
      letters: /[\u0053\u24C8\uFF33\u1E9E\u015A\u1E64\u015C\u1E60\u0160\u1E66\u1E62\u1E68\u0218\u015E\u2C7E\uA7A8\uA784]/g
    },
    {
      base: "T",
      letters: /[\u0054\u24C9\uFF34\u1E6A\u0164\u1E6C\u021A\u0162\u1E70\u1E6E\u0166\u01AC\u01AE\u023E\uA786]/g
    },
    { base: "TZ", letters: /[\uA728]/g },
    {
      base: "U",
      letters: /[\u0055\u24CA\uFF35\u00D9\u00DA\u00DB\u0168\u1E78\u016A\u1E7A\u016C\u00DC\u01DB\u01D7\u01D5\u01D9\u1EE6\u016E\u0170\u01D3\u0214\u0216\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244]/g
    },
    {
      base: "V",
      letters: /[\u0056\u24CB\uFF36\u1E7C\u1E7E\u01B2\uA75E\u0245]/g
    },
    { base: "VY", letters: /[\uA760]/g },
    {
      base: "W",
      letters: /[\u0057\u24CC\uFF37\u1E80\u1E82\u0174\u1E86\u1E84\u1E88\u2C72]/g
    },
    { base: "X", letters: /[\u0058\u24CD\uFF38\u1E8A\u1E8C]/g },
    {
      base: "Y",
      letters: /[\u0059\u24CE\uFF39\u1EF2\u00DD\u0176\u1EF8\u0232\u1E8E\u0178\u1EF6\u1EF4\u01B3\u024E\u1EFE]/g
    },
    {
      base: "Z",
      letters: /[\u005A\u24CF\uFF3A\u0179\u1E90\u017B\u017D\u1E92\u1E94\u01B5\u0224\u2C7F\u2C6B\uA762]/g
    },
    {
      base: "a",
      letters: /[\u0061\u24D0\uFF41\u1E9A\u00E0\u00E1\u00E2\u1EA7\u1EA5\u1EAB\u1EA9\u00E3\u0101\u0103\u1EB1\u1EAF\u1EB5\u1EB3\u0227\u01E1\u00E4\u01DF\u1EA3\u00E5\u01FB\u01CE\u0201\u0203\u1EA1\u1EAD\u1EB7\u1E01\u0105\u2C65\u0250]/g
    },
    { base: "aa", letters: /[\uA733]/g },
    { base: "ae", letters: /[\u00E6\u01FD\u01E3]/g },
    { base: "ao", letters: /[\uA735]/g },
    { base: "au", letters: /[\uA737]/g },
    { base: "av", letters: /[\uA739\uA73B]/g },
    { base: "ay", letters: /[\uA73D]/g },
    {
      base: "b",
      letters: /[\u0062\u24D1\uFF42\u1E03\u1E05\u1E07\u0180\u0183\u0253]/g
    },
    {
      base: "c",
      letters: /[\u0063\u24D2\uFF43\u0107\u0109\u010B\u010D\u00E7\u1E09\u0188\u023C\uA73F\u2184]/g
    },
    {
      base: "d",
      letters: /[\u0064\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\uA77A]/g
    },
    { base: "dz", letters: /[\u01F3\u01C6]/g },
    {
      base: "e",
      letters: /[\u0065\u24D4\uFF45\u00E8\u00E9\u00EA\u1EC1\u1EBF\u1EC5\u1EC3\u1EBD\u0113\u1E15\u1E17\u0115\u0117\u00EB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u1E1D\u0119\u1E19\u1E1B\u0247\u025B\u01DD]/g
    },
    { base: "f", letters: /[\u0066\u24D5\uFF46\u1E1F\u0192\uA77C]/g },
    {
      base: "g",
      letters: /[\u0067\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u01E5\u0260\uA7A1\u1D79\uA77F]/g
    },
    {
      base: "h",
      letters: /[\u0068\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u2C76\u0265]/g
    },
    { base: "hv", letters: /[\u0195]/g },
    {
      base: "i",
      letters: /[\u0069\u24D8\uFF49\u00EC\u00ED\u00EE\u0129\u012B\u012D\u00EF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u012F\u1E2D\u0268\u0131]/g
    },
    { base: "j", letters: /[\u006A\u24D9\uFF4A\u0135\u01F0\u0249]/g },
    {
      base: "k",
      letters: /[\u006B\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\uA741\uA743\uA745\uA7A3]/g
    },
    {
      base: "l",
      letters: /[\u006C\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u1E3D\u1E3B\u017F\u0142\u019A\u026B\u2C61\uA749\uA781\uA747]/g
    },
    { base: "lj", letters: /[\u01C9]/g },
    {
      base: "m",
      letters: /[\u006D\u24DC\uFF4D\u1E3F\u1E41\u1E43\u0271\u026F]/g
    },
    {
      base: "n",
      letters: /[\u006E\u24DD\uFF4E\u01F9\u0144\u00F1\u1E45\u0148\u1E47\u0146\u1E4B\u1E49\u019E\u0272\u0149\uA791\uA7A5]/g
    },
    { base: "nj", letters: /[\u01CC]/g },
    {
      base: "o",
      letters: /[\u006F\u24DE\uFF4F\u00F2\u00F3\u00F4\u1ED3\u1ED1\u1ED7\u1ED5\u00F5\u1E4D\u022D\u1E4F\u014D\u1E51\u1E53\u014F\u022F\u0231\u00F6\u022B\u1ECF\u0151\u01D2\u020D\u020F\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\u01ED\u00F8\u01FF\u0254\uA74B\uA74D\u0275]/g
    },
    { base: "oe", letters: /[\u0153\u1D14]/g },
    { base: "oi", letters: /[\u01A3]/g },
    { base: "ou", letters: /[\u0223]/g },
    { base: "oo", letters: /[\uA74F]/g },
    {
      base: "p",
      letters: /[\u0070\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\uA751\uA753\uA755]/g
    },
    { base: "q", letters: /[\u0071\u24E0\uFF51\u024B\uA757\uA759]/g },
    {
      base: "r",
      letters: /[\u0072\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u1E5F\u024D\u027D\uA75B\uA7A7\uA783]/g
    },
    {
      base: "s",
      letters: /[\u0073\u24E2\uFF53\u00DF\u015B\u1E65\u015D\u1E61\u0161\u1E67\u1E63\u1E69\u0219\u015F\u023F\uA7A9\uA785\u1E9B]/g
    },
    {
      base: "t",
      letters: /[\u0074\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0163\u1E71\u1E6F\u0167\u01AD\u0288\u2C66\uA787]/g
    },
    { base: "tz", letters: /[\uA729]/g },
    {
      base: "u",
      letters: /[\u0075\u24E4\uFF55\u00F9\u00FA\u00FB\u0169\u1E79\u016B\u1E7B\u016D\u00FC\u01DC\u01D8\u01D6\u01DA\u1EE7\u016F\u0171\u01D4\u0215\u0217\u01B0\u1EEB\u1EE9\u1EEF\u1EED\u1EF1\u1EE5\u1E73\u0173\u1E77\u1E75\u0289]/g
    },
    {
      base: "v",
      letters: /[\u0076\u24E5\uFF56\u1E7D\u1E7F\u028B\uA75F\u028C]/g
    },
    { base: "vy", letters: /[\uA761]/g },
    {
      base: "w",
      letters: /[\u0077\u24E6\uFF57\u1E81\u1E83\u0175\u1E87\u1E85\u1E98\u1E89\u2C73]/g
    },
    { base: "x", letters: /[\u0078\u24E7\uFF58\u1E8B\u1E8D]/g },
    {
      base: "y",
      letters: /[\u0079\u24E8\uFF59\u1EF3\u00FD\u0177\u1EF9\u0233\u1E8F\u00FF\u1EF7\u1E99\u1EF5\u01B4\u024F\u1EFF]/g
    },
    {
      base: "z",
      letters: /[\u007A\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u2C6C\uA763]/g
    }
  ];

  for (let i = 0; i < defaultDiacriticsRemovalMap.length; i++) {
    s = s.replace(
      defaultDiacriticsRemovalMap[i].letters,
      defaultDiacriticsRemovalMap[i].base
    );
  }

  return s;
};

// capitalizes every word
const capitalize = s =>
  !s
    ? ""
    : s[0].toUpperCase() + s.substr(1).replace(/\s(.)/g, m => m.toUpperCase());
// e.g. this-is-kebab-case
const toKebabCase = s =>
  !s
    ? ""
    : trim(
      s
        .replace(/[^\w ]+/g, " ")
        .replace(/\s+/g, "-")
        .toLowerCase(),
      "-"
    );
// e.g. this_is_snake_case
const toSnakeCase = s => (!s ? "" : toKebabCase(s).replace(/-+/g, "_"));
// e.g. This-Is-Train-Case
const toTrainCase = s =>
  !s ? "" : capitalize(toKebabCase(s).replace(/-+/g, " ")).replace(/\s+/g, "-");
// e.g. thisIsCamelCase
const toCamelCase = s =>
  !s
    ? ""
    : toKebabCase(s)
      .replace(/-/g, " ")
      .replace(/\s(.)/g, m => m.toUpperCase())
      .replace(/\s/g, "")
      .replace(/^(.)/, m => m.toLowerCase());
// e.g. ThisIsPascalCase
const toPascalCase = s => (!s ? "" : capitalize(toCamelCase(s)));

// makes a string URL-segment compliant
const slugify = s => (!s ? "" : toKebabCase(normalizeDiacritics(s)));

// utility object
var stringUtility = {
  equals,
  contains,
  startsWith,
  endsWith,
  trimLeft,
  trimRight,
  trim,
  replaceAll,

  randomize,
  newGuid,

  isEmail,
  isUrl,

  formatBelgianPhone,

  htmlEncode,
  htmlDecode,
  normalizeDiacritics,

  capitalize,
  toKebabCase,
  toSnakeCase,
  toTrainCase,
  toCamelCase,
  toPascalCase,

  slugify
};

// test guid
/*
const TEST_LENGTH = Math.pow(2,16);
console.debug([...new Set([...Array(TEST_LENGTH)].map(guid))].length === TEST_LENGTH);
*/

class EntityService$2 {
  constructor(rootUrl, catalogName, version) {
    this.api = rootUrl;
    this.catalogName = catalogName;
    this.version = version;
  }

  async details(id) {
    const data = await this.list();
    if (!Array.isArray(data) && id == null) {
      return data;
    }
    return data.find(x => x.id === id);
  }
  async list() {
    const url = this.getCatalogUrl();
    const response = await axios.get(url);
    this.checkResponse(response);
    return response.data;
  }

  getCatalogUrl() {
    return `${trimRight(this.api, "/")}/${this.catalogName}.json${this.version ? "?v=" + this.version : ""}`;
  }
  checkResponse(response) {
    if (response.status < 200 || response.status >= 400) {
      console.error("Remote error", { response });
      throw Error(`${response.statusText} (${response.status})`);
    }
  }
}

const redirect = (url, delayInSeconds = 0) => {
  const tag = document.createElement("meta");
  tag.setAttribute("http-equiv", "Refresh");
  tag.setAttribute("content", `${delayInSeconds}; url=${url}`);
  document.head.appendChild(tag);
};

const setMetaTag = (name, content) => {
  let metaTag = document.getElementsByName(name)[0];
  if (metaTag == null) {
    const headerNodes = [...document.head.childNodes.values()];
    const lastMetaTagInHead = headerNodes
      .filter(n => n.tagName === "META")
      .slice(-1)[0];
    metaTag = document.createElement("meta");
    if (lastMetaTagInHead != null) {
      lastMetaTagInHead.insertAdjacentElement("afterend", metaTag);
    } else {
      document.head.appendChild(metaTag);
    }
  }
  metaTag.setAttribute("name", name);
  metaTag.setAttribute("content", content);
};

const setCanonicalTag = url => {
  let metaTag = document.querySelector("[rel=canonical]");
  if (metaTag == null) {
    const headerNodes = [...document.head.childNodes.values()];
    const lastMetaTagInHead = headerNodes
      .filter(n => n.tagName === "META")
      .slice(-1)[0];
    metaTag = document.createElement("meta");
    if (lastMetaTagInHead != null) {
      lastMetaTagInHead.insertAdjacentElement("afterend", metaTag);
    } else {
      document.head.appendChild(metaTag);
    }
  }
  metaTag.setAttribute("rel", "canonical");
  metaTag.setAttribute("href", url);
};

var htmlUtility = {
  redirect,
  setMetaTag,
  setCanonicalTag
};

const isLocalHost = () => {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
};

const isHttps = (url) => {
  const currentUrl = typeof url === "string" ? new URL(url) : url;
  return currentUrl.protocol === "https:";
};

const getHttpsUrl = (url) => {
  const currentUrl = new URL(url);
  if (!isHttps(currentUrl)) {
    return "https:" + url.substring(currentUrl.protocol.length);
  }
  return url;
};

const forceHttps = (currentUrl) => {
  const httpsUrl = getHttpsUrl(currentUrl);
  if (httpsUrl !== currentUrl && !isLocalHost()) {
    redirect(httpsUrl);
  }
};

const toQueryString = (obj, includeNulls = false) => {
  const getUriComponent = (key, value) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  const serialize = (obj, prefix) => {
    return Object.entries(obj)
      .filter((e) => includeNulls || e[1] != null)
      .flatMap(([key, value]) => {
        key = prefix ? `${prefix}[${key}]` : key;
        return Array.isArray(value)
          ? value.map((v) => getUriComponent(key, v)) // array
          : typeof v === "object"
          ? serialize(value, key) // object
          : getUriComponent(key, value); // normal key-value
      });
  };
  return serialize(obj).join("&");
};

const getQueryStringParams = (url = window.location.href) => {
  const urlObj = new URL(url);
  const queryParams = new URLSearchParams(urlObj.search);
  return Object.fromEntries(queryParams.entries());
};

// utility
var httpUtility = {
  isLocalHost,
  getHttpsUrl,
  forceHttps,
  toQueryString,
  getQueryStringParams,
};

class EntityService$1 {
  constructor(settings) {
    this.listUrl = settings.listUrl;
    this.detailsUrl = settings.detailsUrl;
    this.countUrl = settings.countUrl;
    this.saveUrl = settings.saveUrl;
    this.deleteUrl = settings.deleteUrl;
    this.version = settings.version;
  }

  async details(id) {
    const url = this.getDetailsUrl(id);
    const response = await axios.get(url);
    this.checkResponse(response);
    return response.data;
  }
  async list(so) {
    const url = this.getListUrl(so);
    const response = await axios.get(url);
    this.checkResponse(response);
    return response.data;
  }
  async count(so) {
    const url = this.getCountUrl(so);
    const response = await axios.get(url);
    this.checkResponse(response);
    return response.data;
  }
  async save(item) {
    const url = this.getSaveUrl(item);
    try {
      const response = await axios.post(url, item);
      this.checkResponse(response);
      if (response.data && response.data.saved) {
        return response.data.saved;
      }
    }
    catch (ex) {
      this.throwRemoteError("Saving failed", ex);
    }
    return item;
  }
  async delete(item) {
    const url = this.getDeleteUrl(item);
    try {
      const response = await axios.delete(url);
      this.checkResponse(response);
    }
    catch (ex) {
      this.throwRemoteError("Deleting failed", ex);
    }
    return item;
  }

  getDetailsUrl(id) {
    return this.detailsUrl.replace("{id}", id);
  }
  getListUrl(so = {}) {
    let url = this.listUrl;
    if (Object.keys(so).length > 0) {
      url += "?" + toQueryString(so);
    }
    return url;
  }
  getCountUrl(so = {}) {
    let url = this.countUrl;
    if (Object.keys(so).length > 0) {
      url += "?" + toQueryString(so);
    }
    return url;
  }
  getSaveUrl(item) {
    return this.saveUrl.replace("{id}", item.id || '');
  }
  getDeleteUrl(item) {
    return this.deleteUrl.replace("{id}", item.id);
  }

  checkResponse(response) {
    if (response.status < 200 || response.status >= 400) {
      console.error("Remote error", { response });
      const error = Error(`${response.statusText} (${response.status})`);
      throw error;
    }
  }
  throwRemoteError(msg, ex) {
    const error = Error(msg);
    if (ex.response) {
      error.data = ex.response.data;
      if ("errors" in error.data) {
        error.errors = ex.response.data.errors;
      }
      error.status = ex.response.status;
      error.statusText = ex.response.statusText;
    }
    throw error;
  }
}

var entities = {
    EntityManager,
    JsonService: EntityService$2,
    EntityService: EntityService$1
};

var events = {
    Event,
    EventHandler
};

// consider using https://www.npmjs.com/package/is-plain-object
const isPlainObject = (obj) => typeof obj === "object" && Object.prototype.toString.call(obj) === "[object Object]";

const flattenObject = (obj) => {
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
const crawlObject = (obj, key) => key.split(".").reduce((res, p) => (res == null ? null : res[p]), obj);

const mixin = (target, ...rest) => {
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
const filterObject = (obj, filter) => {
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

var objectUtility = {
  isPlainObject,
  flattenObject,
  crawlObject,
  mixin,
  filterObject,
};

const naturalCompare = (as, bs, f) => {
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
const getRandom = (min = 0, max = min) => {
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
var numberUtility = {
    naturalCompare,
    getRandom
};

const selfSelector = (x) => x;
const compareAsc = (a, b, f) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
const compareDesc = (a, b, f) => (f(a) > f(b) ? -1 : f(a) < f(b) ? 1 : 0);

const isArray$1 = (items) => Array.isArray(items);
const isIterable$1 = (items) => items != null && typeof items[Symbol.iterator] === "function";
const toArray$1 = (items) => (!items ? [] : isArray$1(items) ? items : isIterable$1(items) ? [...items] : Object.values(items));
const newArray$1 = (length) => [...Array(length)];

const orderBy = (items, selector = selfSelector) => {
  const arr = [...items];
  arr.sort((a, b) => compareAsc(a, b, selector));
  return arr;
};
const orderByDesc = (items, selector = selfSelector) => {
  const arr = [...items];
  arr.sort((a, b) => compareDesc(a, b, selector));
  return arr;
};
const naturalSort = (items, selector = selfSelector) => {
  const arr = [...items];
  arr.sort((a, b) => naturalCompare(a, b, selector));
  return arr;
};
const shuffle = (items) => {
  const source = [...items]; // copy array
  return [...Array(source.length)].map(() => {
    const index = getRandom(source.length - 1);
    return source.splice(index, 1)[0];
  });
};
const innerJoin = (items1, items2, selector1 = selfSelector, selector2 = selfSelector, resultSelector = selector1) => {
  const result = [];
  const arr1 = toArray$1(items1);
  const arr2 = toArray$1(items2);
  arr1.forEach((x) => {
    const joinedItems = arr2.filter((y) => selector1(x) === selector2(y));
    joinedItems.forEach((y) => {
      result.push(resultSelector(x, y));
    });
  });
  return result;
};
const groupBy = (items, keySelector) => {
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
const groupJoin = (
  parentItems,
  childItems,
  parentKeySelector = selfSelector,
  childSelector = selfSelector,
  resultSelector = (parent, children) => [parent, children]
) => {
  const childArr = toArray$1(childItems);
  return toArray$1(parentItems)
    .map((x, i, parents) => [x, childArr.filter((y, j, children) => parentKeySelector(x, i, parents) === childSelector(y, j, children))])
    .map(([groupedKey, groupedValues]) => resultSelector(groupedKey, groupedValues));
};
const count = (items, predicate) => {
  const arr = toArray$1(items);
  return predicate ? arr.filter(predicate).length : arr.length;
};
const first = (items, predicate) => {
  const arr = toArray$1(items);
  if (!predicate) {
    return arr[0];
  }
  return arr.find(predicate);
};
const last = (items, predicate) => {
  const arr = toArray$1(items);
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
const distinctBy = (items, selector) => {
  const arr = toArray$1(items);
  return arr.reduce((r, v) => (r.some((x) => selector(x) === selector(v)) ? r : r.concat([v])), []);
};
const distinct = (items) => {
  return [...new Set(items)];
  //return distinctBy(items, selfSelector);
};
const union = (arr1, arr2) => {
  return distinct(toArray$1(arr1).concat(toArray$1(arr2)));
};
const take = (items, n) => {
  return toArray$1(items).slice(0, n);
};
const skip = (items, n) => {
  return toArray$1(items).slice(n);
};
const page = (items, pageSize, pageIndex = 0) => {
  const skip = pageSize * pageIndex;
  return toArray$1(items).slice(skip, skip + pageSize);
};
const countPages = (items, pageSize) => {
  const totalSize = toArray$1(items).length;
  return Math.ceil(totalSize / pageSize);
};

const min = (items, selector = selfSelector) => {
  //return Math.min(...items.map(selector)); -> only numeric
  const arr = toArray$1(items);
  if (!arr.length) {
    return undefined;
  }
  return arr.reduce((r, x) => {
    const v = selector(x);
    return r == null || v < r ? v : r;
  }, null);
};
const max = (items, selector = selfSelector) => {
  //return Math.max(...items.map(selector)); -> only numeric
  const arr = toArray$1(items);
  if (!arr.length) {
    return undefined;
  }
  return arr.reduce((r, x) => {
    const v = selector(x);
    return r == null || v > r ? v : r;
  }, null);
};
const sum = (items, selector = selfSelector) => {
  return toArray$1(items).reduce((r, x) => r + selector(x), 0);
};
const average = (items, selector) => {
  return sum(items, selector) / items.length;
};
const toMap = (items, keySelector, valueSelector = selfSelector) => {
  const arr = toArray$1(items);
  return arr.reduce((map, item, i) => {
    const key = keySelector(item);
    const value = valueSelector(item, i, map);
    return map.set(key, value);
  }, new Map());
  // const entries = groupBy(items, keySelector).map(x => [x[0], x[1].map(valueSelector)]);
  // return new Map(entries);
};
const sameContent = (items1, items2, includeOrder = true) => {
  if (items1 === items2) {
    return true;
  }
  if (items1 == null || items2 == null) {
    return false;
  }
  const arr1 = toArray$1(items1);
  const arr2 = toArray$1(items2);
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

const query = (items, filter) => {
  const arr = toArray$1(items);
  return arr.filter((x) => filterObject(x, filter));
};
const getEnumerator = (arr) => {
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
const move = (arr, item, pos) => {
  const index = arr.indexOf(item);
  if (index !== -1) {
    arr.splice(index, 1);
    arr.splice(pos, 0, item);
  }
};
const reFill = (arr, values) => {
  arr.splice(0, arr.length, ...values);
};

var arrayUtility = {
  isArray: isArray$1,
  isIterable: isIterable$1,
  toArray: toArray$1,
  newArray: newArray$1,
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

const { isArray, isIterable, toArray, newArray, ...arrayFunctions } = arrayUtility;

var arrayExtensions = {
	injectInto(target, overwrite = false) {
		Object.getOwnPropertyNames(arrayFunctions)
			.forEach(prop => {
				if (prop !== "constructor" && (overwrite || !target.hasOwnProperty(prop))) {
					Object.defineProperty(target, prop, {
						value: function () {
							const args = [this, ...arguments];
							return arrayFunctions[prop].apply(this, args);
						},
						configurable: true
					});
				}
			});
	},
	use(overwrite = false) {
		this.injectInto(Array.prototype, overwrite);
	}
};

const isValidDate = (date) => {
  var dateObj = date instanceof Date ? date : new Date(date);
  return !isNaN(+dateObj);
};

const timer = {
  last: new Date().getTime(),
  log(dateToCompare) {
    const newTime = new Date().getTime();
    const sourceTime = dateToCompare ? new Date(dateToCompare).getTime() : this.last;
    this.last = newTime;
    return newTime - sourceTime;
  },
};

const countDown = (startDate, interval = 1000) => {
  // https://stackoverflow.com/questions/13903897/javascript-return-number-of-days-hours-minutes-seconds-between-two-dates#answer-13904120
  const countDownValues = {};
  const update = () => {
    const now = new Date();
    let delta = Math.abs(startDate - now) / 1000;

    countDownValues.days = Math.floor(delta / 86400);
    delta -= countDownValues.days * 86400;

    countDownValues.hours = Math.floor(delta / 3600) % 24;
    delta -= countDownValues.hours * 3600;

    countDownValues.minutes = Math.floor(delta / 60) % 60;
    delta -= countDownValues.minutes * 60;

    countDownValues.seconds = Math.floor(delta);
  };

  setInterval(update, interval);
  update();

  return countDownValues;
};

const getTimezoneOffset = function(date) {
  if (!isValidDate(date)) {
    return "";
  }

  const offset = -date.getTimezoneOffset();
  const timezoneOffsetInHours = offset / 60;
  const timezoneOffsetMinutes = offset % 60;
  const sign = timezoneOffsetInHours >= 0 ? "+" : "-";
  return `${sign}${Math.abs(timezoneOffsetInHours)
    .toString()
    .padStart(2, "0")}:${Math.abs(timezoneOffsetMinutes)
    .toString()
    .padStart(2, "0")}`;
};

/**
 * Stringifies the date without timezone 'correction' in JSON format
 * @param {Date|number} date
 *  the date as Date or time in milliseconds
 * @returns the serialized date
 */
const stringifyDate = function(date) {
  if (!isValidDate(date)) {
    return null;
  }

  //https://stackoverflow.com/questions/31096130/how-to-json-stringify-a-javascript-date-and-preserve-timezone#36643588
  const inputDate = date instanceof Date ? date : new Date(date);
  const correctedDate = new Date(date instanceof Date ? date.getTime() : date);
  const timezoneOffset = getTimezoneOffset(inputDate);
  correctedDate.setHours(inputDate.getHours() + parseInt(timezoneOffset.split(":")[0]));
  const iso = correctedDate.toISOString().replace("Z", "");
  return `${iso}${timezoneOffset}`;
};

var datetimeUtility = {
  isValidDate,
  timer,
  countDown,
  stringifyDate,
};

var dateExtensions = {
    use() {
        Date.prototype.toJSON = function () {
            return stringifyDate(this);
        };
    }
};

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
const debounceToPromise = (func, wait = 250) => {
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
const enqueue = async (arr) => {
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
var promiseUtility = {
    debounceToPromise,
    enqueue
};

var promiseExtensions = {
    use() {
        Promise.debounce = debounceToPromise;
        Promise.enqueue = enqueue;
    }
};

var extensions = {
    useArrayExtensions: arrayExtensions.use.bind(arrayExtensions),
    useDateExtensions: dateExtensions.use.bind(dateExtensions),
    usePromiseExtensions: promiseExtensions.use.bind(promiseExtensions)
};

//import axios from 'axios';// need axios for IE compatibility


class FirebaseError extends Error {
    constructor(message, statusCode) {
        super(`${message} (${statusCode})`);

        this.code = statusCode;
    }
}

// response parser
const checkResponse = response => {
    const statusCode = response.status;
    if (statusCode < 200 || statusCode >= 400) {
        const message = (response.data && response.data.error)
            ? response.data.error.message
            : response.statusText;
        console.error("Firebase Error", statusCode, { message, response });
        throw new FirebaseError(message, statusCode);
    }
};

// axios wrapper
const http = async (url, method, data) => {
    const config = { url, method };
    if (typeof (data) !== 'undefined') {
        config.data = data;
    }
    const response = await axios(config);
    checkResponse(response);
    return response.data;
};

// Firebase communicator
var communicator = {
    get: url => http(url, 'get'),
    put: (url, data) => http(url, 'put', data),
    post: (url, data) => http(url, 'post', data),
    delete: url => http(url, 'delete')
};

function getCatalogItemUrl(url, catalogName, id) {
    return `${trimRight(url, '/')}/${catalogName}/${id}.json`;
}function getCatalogUrl(url, catalogName) {
    return `${trimRight(url, '/')}/${catalogName}.json`;
}

// Entities
async function details(apiUrl, catalogName, id) {
    const url = id ? getCatalogItemUrl(apiUrl, catalogName, id) : getCatalogUrl(apiUrl, catalogName);
    return communicator.get(url);
}async function list(apiUrl, catalogName) {
    const url = getCatalogUrl(apiUrl, catalogName);
    const result = await communicator.get(url);
    const items = Object.entries(result)
        .map(entry => ({
            ...entry[1],// value -> item
            id: entry[0]// key -> id
        }));
    items.sort((x1, x2) => x1.sortOrder - x2.sortOrder);
    return items;
}async function saveEntity(apiUrl, catalogName, item) {
    const isNew = !item.id;
    const url = isNew ? getCatalogUrl(apiUrl, catalogName) : getItemUrl(apiUrl, catalogName, item.id);
    const method = isNew ? "post" : "put";
    return communicator[method](url, item);
}async function deleteEntity(apiUrl, catalogName, item) {
    const url = getItemUrl(apiUrl, catalogName, item.id);
    return communicator.delete(url);
}async function importEntities(apiUrl, catalogName, items) {
    return [...items].map(async (item, index) => {
        item.sortOrder = index;
        return await saveEntity(apiUrl, catalogName, item);
    });
}

class EntityService {
    constructor({ catalogName, apiUrl }) {
        this.apiUrl = apiUrl || arguments[0];
        this.catalogName = catalogName || arguments[1];
    }


    async details(id) {
        return details(this.apiUrl, this.catalogName, id);
    }
    async list() {
        return list(this.apiUrl, this.catalogName);
    }
    async save(item) {
        return saveEntity(this.apiUrl, this.catalogName, item);
    }
    async delete(item) {
        return deleteEntity(this.apiUrl, this.catalogName, item);
    }
    async import(items) {
        return importEntities(this.apiUrl, this.catalogName, items);
    }
}

const AUTH_URLS = {
    REFRESH_TOKEN: 'https://securetoken.googleapis.com/v1',
    IDENTITY_TOOLKIT: 'https://identitytoolkit.googleapis.com/v1/accounts:'
};
function getRestUrl(url, key, action) {
    return `${url}/${action}/?key=${key}`;
}

// Sign in with email / password
async function login(key, email, password) {
    const url = getRestUrl(AUTH_URLS.IDENTITY_TOOLKIT, key, 'accounts:verifyPassword');
    const data = {
        email,
        password,
        returnSecureToken: true
    };
    const {
        idToken,
        refreshToken,
        expiresIn,
        localId: userId
    } = await communicator.post(url, data);
    
    return { idToken, refreshToken, expiresIn, userId };
}// Exchange a refresh token for an ID token
async function refresh(key, refreshToken) {
    const url = getRestUrl(AUTH_URLS.REFRESH_TOKEN, key, 'token');
    const data = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    };
    const {
        id_token: idToken,
        refresh_token: newRefreshToken,// use 'newRefreshToken' to prevent name collision with input refreshToken
        expires_in: expiresIn,
        user_id: userId
    } = await communicator.post(url, data);

    return { idToken, refreshToken: newRefreshToken, expiresIn, userId };
}// Send password reset email
async function resetPassword(key, email) {
    const url = getRestUrl(AUTH_URLS.IDENTITY_TOOLKIT, key, 'accounts:sendOobCode');
    const data = {
        email,
        requestType: 'PASSWORD_RESET'
    };
    await communicator.post(url, data);

    return true;
}

class AuthenticationService$1 {
    constructor(options) {
        this.apiKey = options.apiKey || options;
    }

    async login(email, password) {
        return login(this.apiKey, email, password);
    }
    async refresh(refreshToken) {
        return refresh(this.apiKey, refreshToken);
    }
    async resetPassword(email) {
        return resetPassword(this.apiKey, email);
    }
}

var firebase = {
    EntityService,
    AuthenticationService: AuthenticationService$1
};

/**
 * Handles login/logoff and saves state of current identity
 * automatically refreshes token when autoRefresh is enabled
 */
class IdentityManager {
    constructor({ authenticationService, autoRefresh = false }) {
        this._service = authenticationService;
        this._autoRefreshTimer = null;
        this._autoRefresh = autoRefresh;

        this._setState();
    }


    get autoRefresh() {
        return this._autoRefresh;
    }
    set autoRefresh(value) {
        this._autoRefresh = !!value;
        this._checkAutoRefresh();
    }


    async login(email, password) {
        const identityResponse = await this._service.login(email, password);
        this._setState(identityResponse);
        this._checkAutoRefresh();
        return this.trigger('login', { ...this.state });
    }
    async refresh() {
        const identityResponse = await this._service.refresh(this.state.refreshToken);
        this._setState(identityResponse);
        this._checkAutoRefresh();
        return this.trigger('refresh', { ...this.state });
    }
    async logoff() {
        const oldState = { ...this.state };
        this._setState();
        return this.trigger('logoff', oldState);
    }


    _setState(response = null) {
        if (!response) {
            this.state = { isAuthenticated: false };
            return;
        }

        this.state = {
            ...response,
            expiresAt: new Date(new Date().getTime() + response.expiresIn * 1000),
            isAuthenticated: true
        };
    }
    _checkAutoRefresh() {
        const mgr = this;
        if (this._autoRefreshTimer) {
            clearTimeout(this._autoRefreshTimer);
        }
        if (this._autoRefresh) {
            const refreshInMs = Math.abs(this.state.expiresAt - new Date()) - (60 * 1000);//1 minute to spare
            this._autoRefreshTimer = setTimeout(mgr.refresh, refreshInMs);
        }
    }
}
EventHandler.injectInto(IdentityManager.prototype);

class AuthenticationService {
    constructor() {
        console.warn('This is a dummy-service');
    }

    async login(email, password) {
        console.warn('Not implemented: login');
    }
    async refresh(refreshToken) {
        console.warn('Not implemented: refresh');
    }
    async resetPassword(email) {
        console.warn('Not implemented: resetPassword');
    }
}

var identity = {
    IdentityManager,
    DummyService: AuthenticationService
};

function byteStringToBlob(byteString, filename, type) {
  // write the bytes of the string to an ArrayBuffer
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  // write the ArrayBuffer to a blob, and you're done
  const blob = new Blob([ab], { type });
  blob.name = filename;
  return blob;
}
function base64StringToBlob(byteString, type, sliceSize = 512) {
  // https://stackoverflow.com/questions/16245767/creating-a-blob-from-a-base64-string-in-javascript#answer-16245768

  const byteArrays = [];

  for (let offset = 0; offset < byteString.length; offset += sliceSize) {
    const slice = byteString.slice(offset, offset + sliceSize);

    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }

    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  const blob = new Blob(byteArrays, { type });
  return blob;
}

const isFile = (item) => item != null && item instanceof Blob;
const createUrl = (blob) => URL.createObjectURL(blob);
const revokeUrl = (url) => URL.revokeObjectURL(url);
const getFilename = (uri) => {
  if (!uri || !uri.includes("/")) {
    return uri;
  }
  if (uri.endsWith("/")) {
    throw new Error("filename cannot end with a '/'");
  }
  return last(uri.split("/").filter((x) => x));
};
const getExtension = (filename) => {
  const filenameSegments = filename.split(".");
  const filenameSegmentsWithoutFirst = skip(filenameSegments, 1);
  const ext = last(filenameSegmentsWithoutFirst);
  return ext ? "." + ext : "";
};
const getFilenameWithoutExtension = (uri) => {
  if (!uri) {
    return null;
  }
  
  const filename = getFilename(uri);
  if (!filename.includes(".")) {
    return filename;
  }
  const filenameSegments = filename.split(".");
  return take(filenameSegments, filenameSegments.length - 1 || 1).join(".");
};
const toFormData = (files, data, { filesParameterName = "files" } = {}) => {
  var flattenedData = flattenObject(data);
  const formData = toArray$1(files).reduce((r, f) => {
    r.append(filesParameterName, f, f.name);
    return r;
  }, new FormData());
  return Object.entries(flattenedData).reduce((r, e) => {
    r.append(e[0], e[1]);
    return r;
  }, formData);
};

const fileToBlob = async (file, filename, type) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(byteStringToBlob(reader.result, filename || file.name, type || file.type));
    reader.readAsBinaryString(file);
  });
};
const base64ToBlob = (base64, filename, type) => {
  const hasType = base64.substr(0, 100).includes(",");
  const input = hasType ? base64.substr(base64.indexOf(",") + 1) : base64;

  if (!type && hasType) {
    type = base64
      .substr(0, base64.indexOf(","))
      .split(":")[1]
      .split(";")[0];
  }

  const decodedInput = atob(input);

  const blob = base64StringToBlob(decodedInput, type);
  blob.name = filename;
  return blob;

  // https://stackoverflow.com/questions/12168909/blob-from-dataurl/36183379#answer-12300351
  // let byteString = null;

  // if (base64.startsWith("data:")) {
  //   // convert base64 to raw binary data held in a string
  //   // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
  //   const segments = base64.split(",");
  //   byteString = atob(last(segments));
  //   if (!type) {
  //     type = segments[0].split(":")[1].split(";")[0];
  //   }
  // } else {
  //   byteString = base64;
  // }

  // return byteStringToBlob(byteString, filename, type);
};
const urlToBlob = async (url, filename) => {
  const response = await fetch(url);

  // try to get filename from content-disposition header
  const disposition = response.headers.get("content-disposition");
  if (disposition && disposition.indexOf("attachment") !== -1) {
    var filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
    var matches = filenameRegex.exec(disposition);
    if (matches != null && matches[1]) {
      filename = matches[1].replace(/['"]/g, "");
    }
  }

  const blob = await response.blob();

  if (filename) {
    blob.name = filename;
  }
  return blob;
};
const blobToBase64 = async (blob) => {
  return new Promise(function(resolve) {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(blob);
  });
};

const readAllText = async (blob) => {
  return new Promise(function(resolve) {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsText(blob);
  });
};
const writeAllText = (content, filename, type) => {
  const blob = new Blob([content], { type });
  if (filename) {
    blob.name = filename;
  }
  return blob;
};

const saveAs = (blob, filename) => {
  // http://purl.eligrey.com/github/FileSaver.js/blob/master/FileSaver.js
  const saveAs = (function(e) {
    if (e == null || (typeof navigator !== "undefined" && /MSIE [1-9]\./.test(navigator.userAgent))) {
      return null;
    }
    var t = e.document,
      n = function() {
        return e.URL || e.webkitURL || e;
      },
      r = t.createElementNS("http://www.w3.org/1999/xhtml", "a"),
      o = "download" in r,
      a = function(e) {
        var t = new MouseEvent("click");
        e.dispatchEvent(t);
      },
      i = /constructor/i.test(e.HTMLElement) || e.safari,
      f = /CriOS\/[\d]+/.test(navigator.userAgent),
      u = function(t) {
        (e.setImmediate || e.setTimeout)(function() {
          throw t;
        }, 0);
      },
      s = "application/octet-stream",
      d = 1e3 * 40,
      c = function(e) {
        var t = function() {
          if (typeof e === "string") {
            n().revokeObjectURL(e);
          } else {
            e.remove();
          }
        };
        setTimeout(t, d);
      },
      l = function(e, t, n) {
        t = [].concat(t);
        var r = t.length;
        while (r--) {
          var o = e["on" + t[r]];
          if (typeof o === "function") {
            try {
              o.call(e, n || e);
            } catch (a) {
              u(a);
            }
          }
        }
      },
      p = function(e) {
        if (/^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(e.type)) {
          return new Blob([String.fromCharCode(65279), e], { type: e.type });
        }
        return e;
      },
      v = function(t, u, d) {
        if (!d) {
          t = p(t);
        }
        var v = this,
          w = t.type,
          m = w === s,
          y,
          h = function() {
            l(v, "writestart progress write writeend".split(" "));
          },
          S = function() {
            if ((f || (m && i)) && e.FileReader) {
              var r = new FileReader();
              r.onloadend = function() {
                var t2 = f ? r.result : r.result.replace(/^data:[^;]*;/, "data:attachment/file;");
                var n = e.open(t2, "_blank");
                if (!n) e.location.href = t2;
                v.readyState = v.DONE;
                h();
              };
              r.readAsDataURL(t);
              v.readyState = v.INIT;
              return;
            }
            if (!y) {
              y = n().createObjectURL(t);
            }
            if (m) {
              e.location.href = y;
            } else {
              var o = e.open(y, "_blank");
              if (!o) {
                e.location.href = y;
              }
            }
            v.readyState = v.DONE;
            h();
            c(y);
          };
        v.readyState = v.INIT;
        if (o) {
          y = n().createObjectURL(t);
          setTimeout(function() {
            r.href = y;
            r.download = u;
            a(r);
            h();
            c(y);
            v.readyState = v.DONE;
          });
          return;
        }
        S();
      },
      w = v.prototype,
      m = function(e, t, n) {
        return new v(e, t || e.name || "download", n);
      };
    if (typeof navigator !== "undefined" && navigator.msSaveOrOpenBlob) {
      return function(e, t, n) {
        t = t || e.name || "download";
        if (!n) {
          e = p(e);
        }
        return navigator.msSaveOrOpenBlob(e, t);
      };
    }
    w.abort = function() {};
    w.readyState = w.INIT = 0;
    w.WRITING = 1;
    w.DONE = 2;
    w.error = w.onwritestart = w.onprogress = w.onwrite = w.onabort = w.onerror = w.onwriteend = null;
    return m;
  })((typeof self !== "undefined" && self) || (typeof window !== "undefined" && window)/* || this.content*/);
  return saveAs(blob, filename || blob.name || "file");
};

const formatFileSize = (bytes, si = true, dp = 1) => {
  // https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string/10420404
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + " B";
  }

  const units = si ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"] : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

  return bytes.toFixed(dp) + " " + units[u];
};

// utility
var fileUtility = {
  isFile,
  createUrl,
  revokeUrl,
  getFilename,
  getExtension,
  getFilenameWithoutExtension,
  toFormData,

  fileToBlob,
  base64ToBlob,
  urlToBlob,
  blobToBase64,

  readAllText,
  writeAllText,

  saveAs,

  formatFileSize,
};

class FileHelper {
  async getBlob(input, filename, type) {
    let blob;
    if (input instanceof File) {
      // make sure a blob is returned (name property of File is read-only)
      return fileUtility.fileToBlob(input, filename, type);
    }

    if (input instanceof Blob) {
      blob = input;
      if (filename && blob.name !== filename) {
        blob.name = filename;
      }
      // if (type && blob.type !== type) {
      //   blob.type = type;
      // }
      return blob;
    }

    if (typeof input === "string") {
      // url
      if (isUrl(input)) {
        return fileUtility.urlToBlob(input, filename, type);
      }
      // base64
      return fileUtility.base64ToBlob(input, filename, type);
    }

    throw Error("Cannot convert input to type Blob");
  }

  async getBase64Url(input) {
    const blob = await this.getBlob(input);
    return fileUtility.getBase64Url(blob);
  }
  async createUrl(input) {
    const blob = await this.getBlob(input);
    return fileUtility.blobToBase64(blob);
  }
  async browse(options = {}) {
    return new Promise(function(resolve) {
      const input = document.createElement("INPUT");
      input.setAttribute("type", "file");

      if (options.multiple == null || options.multiple) {
        input.setAttribute("multiple", "true");
      }
      if (options.accept) {
        input.setAttribute("accept", Array.isArray(options.accept) ? options.accept.join(",") : options.accept);
      }

      input.value = "";
      input.setAttribute("style", "display: none;");
      function changeListener() {
        const files = [...this.files];
        input.removeEventListener("change", changeListener);
        document.body.removeChild(input);
        resolve(files);
      }
      input.addEventListener("change", changeListener);
      document.body.appendChild(input);
      input.click();
    });
  }
  async readJson(blob) {
    const content = await fileUtility.readAllText(blob);
    try {
      return JSON.parse(content);
    } catch (ex) {
      console.error("Could not parse blob to JSON", {
        blob,
        content,
        error: ex,
      });
      throw ex;
    }
  }
  async writeJson(object, filename) {
    const json = JSON.stringify(object, null, 2);
    const blob = fileUtility.writeAllText(json, filename, "application/json");
    return blob;
  }
  async send(url, files, data = {}, options = {}) {
    const formData = fileUtility.toFormData(files || [], data || {}, options || {});
    const { method = "POST" } = options;

    const headers = {
      "Content-Type": "multipart/form-data",
      ...(options.headers || {}),
    };

    return axios({
      method: method,
      url,
      data: formData,
      headers,
    });
  }
  async saveAs(input, type, filename = null) {
    const blob = await this.getBlob(input, filename || input.name, type || input.type);
    return fileUtility.saveAs(blob, blob.name || "file");
  }
}

const rgbToHex = (r, g, b) =>
  "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");

const hexToRgb = (hex, opacity) => {
  if (hex.length === 4) {
    // e.g. #FFF
    hex =
      "#" +
      toArray$1(trim(hex, "#").toLowerCase()).reduce((r, x) => r + x + x, "");
  }
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
        a: opacity != undefined ? opacity : 1
      }
    : null;
};
const hexToRgbString = (hex, opacity) => {
  const rgba = hexToRgb(hex, opacity);
  return rgba ? `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})` : null;
};
const hexToRgbArray = (hex, opacity) => {
  const { r, g, b, a = 1 } = hexToRgb(hex, opacity);
  return [r, g, b, a];
};
const getRgbString = (input, opacity) => {
  if (isArray$1(input)) {
    const [r, g, b, a = 1] = input;
    return `rgba(${r},${g},${b},${a})`;
  }
  if (typeof input === "string") {
    if (startsWith(input, "#")) {
      return hexToRgbString(input, opacity);
    }
    if (startsWith(input, "rgba")) {
      return input;
    }
    if (startsWith(input, "rgb")) {
      const segments = trim(input.substring("rgb".length), "()").split(",");
      return getRgbString(segments, opacity);
    }
  }
  return null;
};
const invertRgb = (r, g, b) => {
  const [ri, gi, bi] = [r, g, b].map(x => 255 - x);
  return { ri, gi, bi };
};
const invertHex = hex => {
  const rgb = hexToRgbArray(hex);
  const invertedRgb = invertRgb.apply(null, rgb);
  return rgbToHex.apply(null, invertedRgb);
};
const grayscale = (hex, type = "average") => {
  const rgb = take(hexToRgbArray(hex), 3); //skip opacity
  let gray;
  switch (type) {
    case "light": {
      const maxValue = parseInt(max(rgb) * 0.8, 10);
      gray = [maxValue, maxValue, maxValue];
      break;
    }
    case "dark": {
      const minValue = parseInt(min(rgb), 10);
      gray = [minValue, minValue, minValue];
      break;
    }
    case "weight": {
      const factors = [0.21, 0.72, 0.07];
      const weighted = sum(rgb, (x, i) => parseInt(x * factors[i], 10));
      gray = [weighted, weighted, weighted];
      break;
    }
    default: //'average'
    {
      const avg = parseInt(average(rgb), 10);
      gray = [avg, avg, avg];
      break;
    }
  }
  return rgbToHex.apply(null, gray);
};

// utility
var colorUtility = {
  rgbToHex,
  hexToRgb,

  hexToRgbString,
  hexToRgbArray,
  getRgbString,

  invertRgb,
  invertHex,

  grayscale
};

const contentTypes = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};
const DEFAULT_CONTENTTYPE = contentTypes.jpg;

const getImageContentType = async (img) => {
  // https://stackoverflow.com/questions/18299806/how-to-check-file-mime-type-with-javascript-before-upload#answer-29672957
  const blob = await imageToBlob(img);
  const fileReader = new FileReader();
  return new Promise((resolve) => {
    fileReader.onloadend = (e) => {
      const arr = new Uint8Array(e.target.result).subarray(0, 4);
      let header = "";
      for (var i = 0; i < arr.length; i++) {
        header += arr[i].toString(16);
      }
      let type;
      switch (header) {
        case "89504e47":
          type = contentTypes.png;
          break;
        case "47494638":
          type = contentTypes.gif;
          break;
        case "ffd8ffe0":
        case "ffd8ffe1":
        case "ffd8ffe2":
        case "ffd8ffe3":
        case "ffd8ffe8":
          type = contentTypes.jpg;
          break;
        default:
          type = undefined;
          break;
      }
      resolve(type);
    };
    fileReader.readAsArrayBuffer(blob);
  });
};
const parseContentType = (type) => (type || contentTypes.jpg).replace("/jpg", "/jpeg");

const createCanvas = (width, height, options = { backgroundColor: "#ffffff", imageSmoothingEnabled: false }) => {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (options) {
    get2dContext(canvas, options);
  }
  return canvas;
};
const get2dContext = (canvas, options) => {
  const ctx = canvas.getContext("2d");
  if (typeof options !== "undefined") {
    Object.keys(options).forEach(function(x) {
      const option = options[x];
      if (option !== null) {
        switch (x) {
          case "backgroundColor":
          case "background-color":
            ctx.fillStyle = getRgbString(option);
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            break;
          case "image":
            ctx.drawImage(option, 0, 0);
            break;
          default:
            ctx[x] = option;
        }
      }
    });
  }
  return ctx;
};
const clearCanvas = (canvas) => {
  const ctx = get2dContext(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

const urlToImage = async (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
};
const blobToImage = async (blob) => urlToImage(fileUtility.createUrl(blob));
const imageToBlob = async (img, filename, type) => {
  const contentType = parseContentType(type);
  return fileUtility.urlToBlob(img.src, filename, contentType);
};
const canvasToImage = async (canvas, type = DEFAULT_CONTENTTYPE, quality = 1) => urlToImage(canvas.toDataURL(type, quality));
const imageToCanvas = (img, width, height) => {
  const canvas = createCanvas(width || img.width, height || img.height);
  const ctx = get2dContext(canvas);
  ctx.drawImage(img, 0, 0, width || img.width, height || img.height);
  return canvas;
};
const canvasToBlob = async (canvas, type = DEFAULT_CONTENTTYPE, quality = 1) => {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
};
const base64ToImage = async (data) => urlToImage(data);
const imageToBase64 = (img, type = DEFAULT_CONTENTTYPE, quality = 1) => {
  const canvas = imageToCanvas(img);
  return canvas.toDataURL(type, quality);
};

const resizeByScale = async (img, scale, { quality = 1, type = DEFAULT_CONTENTTYPE } = {}) => {
  // https://stackoverflow.com/questions/18922880/html5-canvas-resize-downscale-image-high-quality#answer-19144434
  // scales the canvas by (float) scale < 1
  // returns a new canvas containing the scaled image.
  function downScaleCanvas(sourceCanvas, scale, type) {
    //if (!(scale < 1) || !(scale > 0)) throw ("scale must be a positive number <1 ");
    var sqScale = scale * scale; // square scale = area of source pixel within target
    var sw = sourceCanvas.width; // source image width
    var sh = sourceCanvas.height; // source image height
    var tw = Math.floor(sw * scale); // target image width
    var th = Math.floor(sh * scale); // target image height
    var sx = 0,
      sy = 0,
      sIndex = 0; // source x,y, index within source array
    var tx = 0,
      ty = 0,
      yIndex = 0,
      tIndex = 0; // target x,y, x,y index within target array
    var tX = 0,
      tY = 0; // rounded tx, ty
    var w = 0,
      nw = 0,
      wx = 0,
      nwx = 0,
      wy = 0,
      nwy = 0; // weight / next weight x / y
    // weight is weight of current source point within target.
    // next weight is weight of current source point within next target's point.
    var crossX = false; // does scaled px cross its current px right border ?
    var crossY = false; // does scaled px cross its current px bottom border ?
    var sBuffer = get2dContext(sourceCanvas).getImageData(0, 0, sw, sh).data; // source buffer 8 bit rgba
    var tBuffer = new Float32Array(3 * tw * th); // target buffer Float32 rgb
    var sR = 0,
      sG = 0,
      sB = 0; // source's current point r,g,b
    /* untested !
var sA = 0;  //source alpha  */

    for (sy = 0; sy < sh; sy++) {
      ty = sy * scale; // y src position within target
      tY = 0 | ty; // rounded : target pixel's y
      yIndex = 3 * tY * tw; // line index within target array
      crossY = tY !== (0 | (ty + scale));
      if (crossY) {
        // if pixel is crossing botton target pixel
        wy = tY + 1 - ty; // weight of point within target pixel
        nwy = ty + scale - tY - 1; // ... within y+1 target pixel
      }
      for (sx = 0; sx < sw; sx++, sIndex += 4) {
        tx = sx * scale; // x src position within target
        tX = 0 | tx; // rounded : target pixel's x
        tIndex = yIndex + tX * 3; // target pixel index within target array
        crossX = tX !== (0 | (tx + scale));
        if (crossX) {
          // if pixel is crossing target pixel's right
          wx = tX + 1 - tx; // weight of point within target pixel
          nwx = tx + scale - tX - 1; // ... within x+1 target pixel
        }
        sR = sBuffer[sIndex]; // retrieving r,g,b for curr src px.
        sG = sBuffer[sIndex + 1];
        sB = sBuffer[sIndex + 2];

        /* !! untested : handling alpha !!
           sA = sBuffer[sIndex + 3];
           if (!sA) continue;
           if (sA != 0xFF) {
               sR = (sR * sA) >> 8;  // or use /256 instead ??
               sG = (sG * sA) >> 8;
               sB = (sB * sA) >> 8;
           }
        */
        if (!crossX && !crossY) {
          // pixel does not cross
          // just add components weighted by squared scale.
          tBuffer[tIndex] += sR * sqScale;
          tBuffer[tIndex + 1] += sG * sqScale;
          tBuffer[tIndex + 2] += sB * sqScale;
        } else if (crossX && !crossY) {
          // cross on X only
          w = wx * scale;
          // add weighted component for current px
          tBuffer[tIndex] += sR * w;
          tBuffer[tIndex + 1] += sG * w;
          tBuffer[tIndex + 2] += sB * w;
          // add weighted component for next (tX+1) px
          nw = nwx * scale;
          tBuffer[tIndex + 3] += sR * nw;
          tBuffer[tIndex + 4] += sG * nw;
          tBuffer[tIndex + 5] += sB * nw;
        } else if (crossY && !crossX) {
          // cross on Y only
          w = wy * scale;
          // add weighted component for current px
          tBuffer[tIndex] += sR * w;
          tBuffer[tIndex + 1] += sG * w;
          tBuffer[tIndex + 2] += sB * w;
          // add weighted component for next (tY+1) px
          nw = nwy * scale;
          tBuffer[tIndex + 3 * tw] += sR * nw;
          tBuffer[tIndex + 3 * tw + 1] += sG * nw;
          tBuffer[tIndex + 3 * tw + 2] += sB * nw;
        } else {
          // crosses both x and y : four target points involved
          // add weighted component for current px
          w = wx * wy;
          tBuffer[tIndex] += sR * w;
          tBuffer[tIndex + 1] += sG * w;
          tBuffer[tIndex + 2] += sB * w;
          // for tX + 1; tY px
          nw = nwx * wy;
          tBuffer[tIndex + 3] += sR * nw;
          tBuffer[tIndex + 4] += sG * nw;
          tBuffer[tIndex + 5] += sB * nw;
          // for tX ; tY + 1 px
          nw = wx * nwy;
          tBuffer[tIndex + 3 * tw] += sR * nw;
          tBuffer[tIndex + 3 * tw + 1] += sG * nw;
          tBuffer[tIndex + 3 * tw + 2] += sB * nw;
          // for tX + 1 ; tY +1 px
          nw = nwx * nwy;
          tBuffer[tIndex + 3 * tw + 3] += sR * nw;
          tBuffer[tIndex + 3 * tw + 4] += sG * nw;
          tBuffer[tIndex + 3 * tw + 5] += sB * nw;
        }
      } // end for sx
    } // end for sy

    // create result canvas
    var resultCanvas = createCanvas(tw, th);
    var resultContext = get2dContext(resultCanvas, {
      "background-color": type === contentTypes.jpg ? "#FFF" : null,
    });
    var imgRes = resultContext.getImageData(0, 0, tw, th);
    var tByteBuffer = imgRes.data;
    // convert float32 array into a UInt8Clamped Array
    var pxIndex = 0; //
    for (sIndex = 0, tIndex = 0; pxIndex < tw * th; sIndex += 3, tIndex += 4, pxIndex++) {
      tByteBuffer[tIndex] = Math.ceil(tBuffer[sIndex]);
      tByteBuffer[tIndex + 1] = Math.ceil(tBuffer[sIndex + 1]);
      tByteBuffer[tIndex + 2] = Math.ceil(tBuffer[sIndex + 2]);
      tByteBuffer[tIndex + 3] = 255;
    }
    // writing result to canvas.
    resultContext.putImageData(imgRes, 0, 0);
    return resultCanvas;
  }
  // scales the image by (float) scale < 1
  // returns a canvas containing the scaled image.
  function downScaleImage(img, scale, type) {
    const canvas = createCanvas(img.width, img.height);
    const context = get2dContext(canvas, {
      "background-color": type === contentTypes.png ? "transparent" : type === contentTypes.jpg ? "#FFF" : null,
    });
    context.drawImage(img, 0, 0);
    return downScaleCanvas(canvas, scale, type);
  }

  const contentType = parseContentType(type || (await getImageContentType(img)));

  const downScaledCanvas = downScaleImage(img, scale, contentType);
  return canvasToImage(downScaledCanvas, contentType, quality);
};
const resize = async (img, maxSize, { quality = 1, type = DEFAULT_CONTENTTYPE } = {}) => {
  const { width: sourceWidth, height: sourceHeight } = img;
  let [targetWidth = 0, targetHeight = targetWidth] = isArray$1(maxSize) ? maxSize : [maxSize, maxSize];

  if (targetWidth == 0) {
    // adjusted width, relative to height
    targetWidth = sourceWidth * (targetHeight / sourceHeight);
  }
  if (targetHeight == 0) {
    // adjusted height, relative to width
    targetHeight = sourceHeight * (targetWidth / sourceWidth);
  }

  // https://stackoverflow.com/questions/19262141/resize-image-with-javascript-canvas-smoothly#answer-19262385
  const targetCanvas = createCanvas(targetWidth, targetHeight);
  const targetCtx = get2dContext(targetCanvas, {
    imageSmoothingEnabled: false,
  });

  const factor = 0.5;

  // step 1 - resize to 50%
  const helperCanvas = createCanvas(sourceWidth * factor, sourceHeight * factor);
  const helperCtx = get2dContext(helperCanvas, {
    imageSmoothingEnabled: false,
  });
  // step 2
  helperCtx.drawImage(helperCanvas, 0, 0, sourceWidth * factor, sourceHeight * factor);
  // step 3, resize to final size
  targetCtx.drawImage(helperCanvas, 0, 0, sourceWidth * factor, sourceHeight * factor, 0, 0, targetWidth, targetHeight);

  const contentType = parseContentType(type || (await getImageContentType(img)));

  return canvasToImage(targetCanvas, contentType || contentTypes.png, quality);
};
const rotate = async (img, direction = 1, type = DEFAULT_CONTENTTYPE) => {
  const degrees = direction > 0 ? 90 : direction < 0 ? -90 : 0;

  //get largest dimension (width, height)
  const maxDimension = Math.max(img.width, img.height);

  //get original dimensions
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  //calculate dimensions for rotated image
  const newWidth = degrees !== 0 ? originalHeight : originalWidth;
  const newHeight = degrees !== 0 ? originalWidth : originalHeight;

  const contentType = parseContentType(type || (await getImageContentType(img)));

  //rotate img on canvas
  const canvas = createCanvas(maxDimension, maxDimension);
  const ctx = get2dContext(canvas, {
    imageSmoothingEnabled: false, //keep quality!
    "background-color": contentType === contentTypes.jpg ? "#FFF" : null,
  });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.translate(-(canvas.width / 2), -(canvas.height / 2));
  ctx.drawImage(img, (canvas.width - originalWidth) / 2, (canvas.height - originalHeight) / 2);
  //extract rotated image from canvas
  const imgData = ctx.getImageData((maxDimension - newWidth) / 2, (maxDimension - newHeight) / 2, newWidth, newHeight);

  //paint rotated image on new canvas with correct dimensions
  const canvas2 = createCanvas(newWidth, newHeight);
  const ctx2 = get2dContext(canvas2, {
    imageSmoothingEnabled: false, //keep quality!
    "background-color": contentType === contentTypes.jpg ? "#FFF" : null,
  });
  ctx2.putImageData(imgData, 0, 0);

  return canvasToImage(canvas2, contentType, 1);
};
const flipFlop = async (img, flip, flop, type = DEFAULT_CONTENTTYPE) => {
  const contentType = parseContentType(type || (await getImageContentType(img)));

  const canvas = imageToCanvas(img);
  const ctx = get2dContext(canvas, {
    "background-color": contentType === contentTypes.jpg ? "#FFF" : null,
  });
  ctx.translate(flip ? img.width : 0, flop ? img.height : 0);
  ctx.scale(flip ? -1 : 1, flop ? -1 : 1);
  clearCanvas(canvas);
  ctx.drawImage(img, 0, 0);
  ctx.restore();

  return canvasToImage(canvas, contentType, 1);
};
const convertType = async (img, targetType) => {
  const canvas = createCanvas(img.width, img.height);
  const ctx = get2dContext(canvas, {
    "background-color": targetType === contentTypes.jpg ? "#FFF" : null,
  });
  ctx.drawImage(img, 0, 0);
  return canvasToImage(canvas, targetType, 1);
};
const getLightness = (img) => {
  let colorSum = 0;
  const canvas = imageToCanvas(img);
  const ctx = get2dContext(canvas);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let r, g, b, avg;

  for (let x = 0, len = data.length; x < len; x += 4) {
    r = data[x];
    g = data[x + 1];
    b = data[x + 2];

    avg = Math.floor((r + g + b) / 3);
    colorSum += avg;
  }

  return Math.floor(colorSum / (img.width * img.height));
};
const white2transparent = async (img, tolerance) => {
  const width = img.width;
  const height = img.height;
  const canvas = imageToCanvas(img);
  const ctx = get2dContext(canvas);
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixel = imageData.data;

  const r = 0,
    g = 1,
    b = 2,
    a = 3;
  for (let p = 0; p < pixel.length; p += 4) {
    if (pixel[p + r] >= 255 - tolerance && pixel[p + g] >= 255 - tolerance && pixel[p + b] >= 255 - tolerance) {
      // if white then change alpha to 0
      pixel[p + a] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return canvasToImage(canvas, contentTypes.png, 1);
};

// utility
var imageUtility = {
  contentTypes,
  getImageContentType,
  parseContentType,
  //createCanvas,
  //get2dContext,
  //clearCanvas,

  urlToImage,
  blobToImage,
  imageToBlob,
  canvasToImage,
  imageToCanvas,
  canvasToBlob,
  base64ToImage,
  imageToBase64,

  resizeByScale,
  resize,
  rotate,
  flipFlop,
  convertType,

  getLightness,
  white2transparent,
};

class ImageHelper extends FileHelper {
  async getImage(input) {
    if (input instanceof Image) {
      return input;
    }
    if (typeof input === "string") {
      return imageUtility.urlToImage(input);
    }
    if (input instanceof Blob) {
      return imageUtility.blobToImage(input);
    }
    if (input instanceof HTMLCanvasElement) {
      return imageUtility.canvasToImage(input);
    }
    throw Error("Cannot convert input to type Image");
  }
  async getBlob(input, filename, type) {
    if (input instanceof Image) {
      return imageUtility.imageToBlob(input, filename, type);
    } else if (input instanceof HTMLCanvasElement) {
      return imageUtility.canvasToBlob(input, filename, type);
    }

    return super.getBlob(input, filename, type);
  }

  async resize(input, max, options) {
    const img = await this.getImage(input);
    return imageUtility.resizeByScale(img, Math.min(1, max / Math.max(img.width, img.height)), options);
    //return imageUtility.resize(img, max, options);
  }
  async rotate(input, direction) {
    const type = imageUtility.parseContentType(input.type);
    const img = await this.getImage(input);
    return imageUtility.rotate(img, direction, type);
  }
  async flipHorizontally(input) {
    return this.flipFlop(input, true);
  }
  async flipVertically(input) {
    return this.flipFlop(input, false, true);
  }
  async flipFlop(input, flip, flop, type) {
    const img = await this.getImage(input);
    return imageUtility.flipFlop(img, flip, flop, type);
  }
  async convertType(input, targetType) {
    const img = await this.getImage(input);
    return imageUtility.convertType(img, targetType);
  }

  async getLightness(input) {
    const img = await this.getImage(input);
    return imageUtility.getLightness(img);
  }
  async white2transparent(input, tolerance = 0) {
    const img = await this.getImage(input);
    return imageUtility.white2transparent(img, tolerance);
  }
}

var io = {
    FileHelper,
    ImageHelper
};

class TreeNode {
  constructor(value, parentNode, tree) {
    this._value = value;
    this._parentNode = parentNode;
    this._level = parentNode ? parentNode.level + 1 : 0;
    this._tree = tree;
    this._children = [];
  }

  get value() {
    return this._value;
  }
  get parent() {
    return this._parentNode;
  }
  get level() {
    return this._level;
  }
  get children() {
    return this._children;
  }
  add(value) {
    const node = new TreeNode(value, this, this._tree);
    node._level = this.level + 1;
    this._children.push(node);
    this._tree.push(node);
    return node;
  }
  update(value) {
    this._value = value;
  }

  getOffspring() {
    return this._tree.getOffspring(this);
  }
  getAncestors() {
    return this._tree.getAncestors(this);
  }
  getRoot() {
    return this._tree.getRoots(this)[0];
  }

  *[Symbol.iterator]() {
    for (const child of this.children) {
      yield child;
    }
  }
}

class TreeList extends Array {
  constructor() {
    super();
    this.roots = [];
  }

  // returnType becomes Array when using array-functions on this TreeList
  static get [Symbol.species]() {
    return Array;
  }

  addValue(value, parentNode = null) {
    return this.addValues([value], parentNode)[0];
  }
  addValues(values, parentNode = null) {
    if (!parentNode) {
      const nodes = values.map((v) => new TreeNode(v, null, this));
      this.push(...nodes);
      this.roots.push(...nodes);
      return nodes;
    }
    return values.map((v) => parentNode.add(v));
  }

  /**
   * Retrieves all TreeNodes for the given value(s)
   * @param {any} values (default undefined so we can treat null as a valid value)
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getNodes(values = undefined) {
    if (typeof values === "undefined") {
      return [...this];
    }

    if (!isIterable$1(values)) {
      values = [values];
    }

    const arr = toArray$1(values);
    return this.filter((node) => arr.includes(node.value));
  }
  /**
   * Retrieves all roots for the given TreeNode(s)
   * @param {Array<TreeNode>|TreeNode} nodes
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getRoots(nodes = null) {
    if (!nodes) {
      return [...this.roots];
    }

    nodes = this._ensureNodeList(nodes);

    const roots = nodes.map((node) => {
      let parent = node;
      while (parent.parent) {
        parent = parent.parent;
      }
      return parent;
    });
    return distinct(roots);
  }
  /**
   * Retrieves all parents and their parents for the given TreeNode(s)
   * @param {Array<TreeNode>|TreeNode} nodes (or values)
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getAncestors(nodes) {
    nodes = this._ensureNodeList(nodes);
    const getParents = (node) => (node.parent ? [node.parent].concat(getParents(node.parent)) : []);
    const ancestors = nodes.flatMap(getParents);
    return distinct(ancestors);
  }
  /**
   * Retrieves all children and their children for the given TreeNode(s)
   * @param {Array<TreeNode>|TreeNode} nodes
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getOffspring(nodes) {
    nodes = this._ensureNodeList(nodes);
    const getChildren = (node) => (node.children.length > 0 ? [...node.children, ...node.children.flatMap(getChildren)] : []);
    return nodes.flatMap(getChildren);
  }
  /**
   * Retrieves all (distinct) values from this TreeList
   * @returns {Array<Object>} collection of values
   */
  getValues(nodes = null) {
    nodes = this._ensureNodeList(nodes);
    return nodes.map((x) => x.value);
  }

  _ensureNodeList(nodes) {
    if (nodes instanceof TreeNode) {
      return [nodes];
    }

    return nodes || this;
  }
}

function fallbackCopyTextToClipboard(text) {
  var textArea = document.createElement("textarea");
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  var successful = document.execCommand("copy");
  document.body.removeChild(textArea);

  return Promise.resolve(successful);
}

function copyTextToClipboard(text) {
  if (!navigator.clipboard) {
    return fallbackCopyTextToClipboard(text);
  }
  return navigator.clipboard.writeText(text);
}

var utilities = {
  arrayUtility,
  colorUtility,
  datetimeUtility,
  fileUtility,
  htmlUtility,
  httpUtility,
  imageUtility,
  numberUtility,
  objectUtility,
  promiseUtility,
  stringUtility,
  //webpackUtility,
  clipboardUtility: copyTextToClipboard,
};

var index = {
    entities,
    events,
    extensions,
    firebase,
    identity,
    io,
    TreeList,
    utilities
};

export { TreeList, index as default, entities, events, extensions, firebase, identity, io, utilities };
//# sourceMappingURL=index.js.map
