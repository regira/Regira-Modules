import FileHelper from "./file-helper";
import imageUtility from "../utilities/image-utility";

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

export default ImageHelper;
