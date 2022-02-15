import { details, list, saveEntity, deleteEntity, importEntities } from './entity-utility';

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


export default EntityService;