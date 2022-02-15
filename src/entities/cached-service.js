// class CachedEntityService {
//     constructor(service) {
//         this._service = service;
//         this._details = new Map();
//         this._items = null;
//     }
    
//     async details(id) {
//         const item = this._details.get(id);
//         if (item == null) {
//             item = await this._service.details(id);
//             this._details.set(id, item);
//         }
//         return item;
//     }
//     async list() {
//         if (this._items == null) {
//             this._items = await this._service.list();
//         }
//         return this._items;
//     }
//     async save(item) {
//         this._items = null;
//         this._details.remove(item.id);
//         return this._service.save(item);
//     }
//     async delete(item) {
//         this._items = null;
//         this._details.remove(item.id);
//         return this._service.delete(item);
//     }
// }

// export default CachedEntityService;