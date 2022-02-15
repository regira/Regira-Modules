import axios from "axios";
import { toQueryString } from "../utilities/http-utility";

class EntityService {
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

export default EntityService;
