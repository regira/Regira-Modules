import EventHandler from "../events/event-handler";

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

export default EntityManager;
