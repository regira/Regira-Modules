import axios from "axios";
import { trimRight } from "../utilities/string-utility";

class EntityService {
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

export default EntityService;
