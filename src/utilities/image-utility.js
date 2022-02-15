import { getRgbString } from "./color-utility";
import fileUtility from "./file-utility";
import { isArray } from "./array-utility";

export const contentTypes = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};
const DEFAULT_CONTENTTYPE = contentTypes.jpg;

export const getImageContentType = async (img) => {
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
export const parseContentType = (type) => (type || contentTypes.jpg).replace("/jpg", "/jpeg");

export const createCanvas = (width, height, options = { backgroundColor: "#ffffff", imageSmoothingEnabled: false }) => {
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (options) {
    get2dContext(canvas, options);
  }
  return canvas;
};
export const centerImageOnCanvas = (img) => {
  const maxSize = Math.max(img.width, img.height);
  const canvas = createCanvas(maxSize, maxSize);
  return addImageToCanvas(canvas, img, { top: (maxSize - img.height) / 2, left: (maxSize - img.width) / 2 });
};
export const get2dContext = (canvas, options) => {
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
export const clearCanvas = (canvas) => {
  const ctx = get2dContext(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};
export const addImageToCanvas = (canvas, img, { top = 0, left = 0 } = { top: 0, left: 0 }) => {
  canvas = canvas || createCanvas(img.width + left, img.height + top);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, left, top, img.width, img.height);
  return canvas;
};

export const urlToImage = async (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
};
export const blobToImage = async (blob) => urlToImage(fileUtility.createUrl(blob));
export const imageToBlob = async (img, filename, type) => {
  const contentType = parseContentType(type);
  return fileUtility.urlToBlob(img.src, filename, contentType);
};
export const canvasToImage = async (canvas, type = DEFAULT_CONTENTTYPE, quality = 1) => urlToImage(canvas.toDataURL(type, quality));
export const imageToCanvas = (img, width, height) => {
  const canvas = createCanvas(width || img.width, height || img.height);
  const ctx = get2dContext(canvas);
  ctx.drawImage(img, 0, 0, width || img.width, height || img.height);
  return canvas;
};
export const canvasToBlob = async (canvas, type = DEFAULT_CONTENTTYPE, quality = 1) => {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
};
export const base64ToImage = async (data) => urlToImage(data);
export const imageToBase64 = (img, type = DEFAULT_CONTENTTYPE, quality = 1) => {
  const canvas = imageToCanvas(img);
  return canvas.toDataURL(type, quality);
};

export const resizeByScale = async (img, scale, { quality = 1, type = DEFAULT_CONTENTTYPE } = {}) => {
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
export const resize = async (img, maxSize, { quality = 1, type = DEFAULT_CONTENTTYPE } = {}) => {
  const { width: sourceWidth, height: sourceHeight } = img;
  let [targetWidth = 0, targetHeight = targetWidth] = isArray(maxSize) ? maxSize : [maxSize, maxSize];

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
export const rotate = async (img, direction = 1, type = DEFAULT_CONTENTTYPE) => {
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
export const flip = async (img, type = DEFAULT_CONTENTTYPE) => flipFlop(img, true, false, type);
export const flop = async (img, type = DEFAULT_CONTENTTYPE) => flipFlop(img, false, true, type);
export const flipFlop = async (img, flip, flop, type = DEFAULT_CONTENTTYPE) => {
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
export const convertType = async (img, targetType) => {
  const canvas = createCanvas(img.width, img.height);
  const ctx = get2dContext(canvas, {
    "background-color": targetType === contentTypes.jpg ? "#FFF" : null,
  });
  ctx.drawImage(img, 0, 0);
  return canvasToImage(canvas, targetType, 1);
};

export const getRgbColor = (canvas, pos) => {
  const [x, y] = pos;
  const ctx = get2dContext(canvas);
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return { r, g, b };
};
export const getLightness = (img) => {
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
export const white2transparent = async (img, tolerance) => {
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
export default {
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
