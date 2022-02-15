import TreeNode from "./tree-node";
import { isIterable, toArray, distinct } from "../utilities/array-utility";

class TreeList extends Array {
  constructor() {
    super();
    this.roots = [];
  }

  // returnType becomes Array when using array-functions on this TreeList
  static get [Symbol.species]() {
    return Array;
  }

  addValue(value, parentNode = null) {
    return this.addValues([value], parentNode)[0];
  }
  addValues(values, parentNode = null) {
    if (!parentNode) {
      const nodes = values.map((v) => new TreeNode(v, null, this));
      this.push(...nodes);
      this.roots.push(...nodes);
      return nodes;
    }
    return values.map((v) => parentNode.add(v));
  }

  /**
   * Retrieves all TreeNodes for the given value(s)
   * @param {any} values (default undefined so we can treat null as a valid value)
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getNodes(values = undefined) {
    if (typeof values === "undefined") {
      return [...this];
    }

    if (!isIterable(values)) {
      values = [values];
    }

    const arr = toArray(values);
    return this.filter((node) => arr.includes(node.value));
  }
  /**
   * Retrieves all roots for the given TreeNode(s)
   * @param {Array<TreeNode>|TreeNode} nodes
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getRoots(nodes = null) {
    if (!nodes) {
      return [...this.roots];
    }

    nodes = this._ensureNodeList(nodes);

    const roots = nodes.map((node) => {
      let parent = node;
      while (parent.parent) {
        parent = parent.parent;
      }
      return parent;
    });
    return distinct(roots);
  }
  /**
   * Retrieves all parents and their parents for the given TreeNode(s)
   * @param {Array<TreeNode>|TreeNode} nodes (or values)
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getAncestors(nodes) {
    nodes = this._ensureNodeList(nodes);
    const getParents = (node) => (node.parent ? [node.parent].concat(getParents(node.parent)) : []);
    const ancestors = nodes.flatMap(getParents);
    return distinct(ancestors);
  }
  /**
   * Retrieves all children and their children for the given TreeNode(s)
   * @param {Array<TreeNode>|TreeNode} nodes
   * @returns {Array<TreeNode>} collection of TreeNodes
   */
  getOffspring(nodes) {
    nodes = this._ensureNodeList(nodes);
    const getChildren = (node) => (node.children.length > 0 ? [...node.children, ...node.children.flatMap(getChildren)] : []);
    return nodes.flatMap(getChildren);
  }
  /**
   * Retrieves all (distinct) values from this TreeList
   * @returns {Array<Object>} collection of values
   */
  getValues(nodes = null) {
    nodes = this._ensureNodeList(nodes);
    return nodes.map((x) => x.value);
  }

  _ensureNodeList(nodes) {
    if (nodes instanceof TreeNode) {
      return [nodes];
    }

    return nodes || this;
  }
}

export default TreeList;
