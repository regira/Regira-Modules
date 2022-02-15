import communicator from './communicator';
import { trimRight } from '../utilities/string-utility';


function getCatalogItemUrl(url, catalogName, id) {
    return `${trimRight(url, '/')}/${catalogName}/${id}.json`;
};
function getCatalogUrl(url, catalogName) {
    return `${trimRight(url, '/')}/${catalogName}.json`;
};


// Entities
export async function details(apiUrl, catalogName, id) {
    const url = id ? getCatalogItemUrl(apiUrl, catalogName, id) : getCatalogUrl(apiUrl, catalogName);
    return communicator.get(url);
};
export async function list(apiUrl, catalogName) {
    const url = getCatalogUrl(apiUrl, catalogName);
    const result = await communicator.get(url);
    const items = Object.entries(result)
        .map(entry => ({
            ...entry[1],// value -> item
            id: entry[0]// key -> id
        }));
    items.sort((x1, x2) => x1.sortOrder - x2.sortOrder);
    return items;
};
export async function saveEntity(apiUrl, catalogName, item) {
    const isNew = !item.id;
    const url = isNew ? getCatalogUrl(apiUrl, catalogName) : getItemUrl(apiUrl, catalogName, item.id);
    const method = isNew ? "post" : "put";
    return communicator[method](url, item);
};
export async function deleteEntity(apiUrl, catalogName, item) {
    const url = getItemUrl(apiUrl, catalogName, item.id);
    return communicator.delete(url);
};
export async function importEntities(apiUrl, catalogName, items) {
    return [...items].map(async (item, index) => {
        item.sortOrder = index;
        return await saveEntity(apiUrl, catalogName, item);
    });
};


// utility object
export default {
    details,
    list,
    saveEntity,
    deleteEntity,
    importEntities
};