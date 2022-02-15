import axios from "axios";
import fileUtility from "../utilities/file-utility";
import { isUrl } from "../utilities/string-utility";

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

export default FileHelper;
