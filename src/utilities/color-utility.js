import {
  isArray,
  toArray,
  take,
  sum,
  average,
  min,
  max
} from "./array-utility";
import { startsWith, trim } from "./string-utility";

export const rgbToHex = (r, g, b) =>
  "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");

export const hexToRgb = (hex, opacity) => {
  if (hex.length === 4) {
    // e.g. #FFF
    hex =
      "#" +
      toArray(trim(hex, "#").toLowerCase()).reduce((r, x) => r + x + x, "");
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
export const hexToRgbString = (hex, opacity) => {
  const rgba = hexToRgb(hex, opacity);
  return rgba ? `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})` : null;
};
export const hexToRgbArray = (hex, opacity) => {
  const { r, g, b, a = 1 } = hexToRgb(hex, opacity);
  return [r, g, b, a];
};
export const getRgbString = (input, opacity) => {
  if (isArray(input)) {
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
export const invertRgb = (r, g, b) => {
  const [ri, gi, bi] = [r, g, b].map(x => 255 - x);
  return { ri, gi, bi };
};
export const invertHex = hex => {
  const rgb = hexToRgbArray(hex);
  const invertedRgb = invertRgb.apply(null, rgb);
  return rgbToHex.apply(null, invertedRgb);
};
export const grayscale = (hex, type = "average") => {
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
export default {
  rgbToHex,
  hexToRgb,

  hexToRgbString,
  hexToRgbArray,
  getRgbString,

  invertRgb,
  invertHex,

  grayscale
};
