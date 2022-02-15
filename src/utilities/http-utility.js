import { redirect as htmlRedirect } from "./html-utility";
import { trim } from "./string-utility";

export const isLocalHost = () => {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
};

export const isHttps = (url) => {
  const currentUrl = typeof url === "string" ? new URL(url) : url;
  return currentUrl.protocol === "https:";
};

export const getHttpsUrl = (url) => {
  const currentUrl = new URL(url);
  if (!isHttps(currentUrl)) {
    return "https:" + url.substring(currentUrl.protocol.length);
  }
  return url;
};

export const forceHttps = (currentUrl) => {
  const httpsUrl = getHttpsUrl(currentUrl);
  if (httpsUrl !== currentUrl && !isLocalHost()) {
    htmlRedirect(httpsUrl);
  }
};
export const toAbsoluteUrl = (relative, baseUrl = null) => {
  // https://stackoverflow.com/questions/14780350/convert-relative-path-to-absolute-using-javascript#answer-14780463
  if (!baseUrl) {
    baseUrl = window.location.origin;
  }
  const stack = baseUrl.split("/");
  const parts = trim(relative, "/").split("/");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== ".") {
      if (parts[i] === "..") {
        stack.pop();
      } else {
        stack.push(parts[i]);
      }
    }
  }
  return stack.join("/");
};

export const toQueryString = (obj, includeNulls = false) => {
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

export const getQueryStringParams = (url = window.location.href) => {
  const urlObj = new URL(url);
  const queryParams = new URLSearchParams(urlObj.search);
  return Object.fromEntries(queryParams.entries());
};

// utility
export default {
  isLocalHost,
  getHttpsUrl,
  forceHttps,
  toQueryString,
  getQueryStringParams,
};
