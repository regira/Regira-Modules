import Event from './event';

const getOptions = (argArray) => {
	const key = argArray[0];
	const options = argArray.splice(0, 1)[0];
	const callback = options.callback || argArray[argArray.length - 1];
	const constraint = options.constraint || (
		argArray.length > 2
			? argArray.splice(0, 1).find(function (x) { return x !== callback && typeof (x) === 'function'; })
			: undefined
	);
	const thisScope = options.scope;
	return {
		key: key || '',
		constraint: constraint,
		callback: callback,
		thisScope: thisScope
	};
};
function setListener(options) {
	const me = this;
	options.key.split(' ').forEach(function (x) {
		if (!(x in me.listeners)) {
			me.listeners[x] = [];
		}
		const listener = {
			constraint: options.constraint,
			callback: options.callback,
			scope: options.thisScope,
			once: options.once
		};
		me.listeners[x].push(listener);
	});
}

class EventHandler { }

EventHandler.injectInto = function (target) {
	Object.defineProperties(target, {
		listeners: {
			get: function () {
				//create new object per instance
				if (!('_listeners' in this)) {
					Object.defineProperty(this, '_listeners', { value: {} });
				}
				return this._listeners;
			}
		},
		on: {
			value: function (/*key, constraint, callback*/) {
				const options = getOptions([...arguments]);
				setListener.call(this, options);
				return this;
			},
			configurable: true
		},
		once: {
			value: function (/*key, constraint, callback*/) {
				const options = getOptions([...arguments]);
				options.once = true;
				setListener.call(this, options);
				return this;
			},
			configurable: true
		},
		off: {
			value: function (key, listener) {
				if (this.listeners[key]) {
					if (this.listeners[key].length && typeof listener === 'function') {
						const index = this.listeners[key].findIndex(function (x) { return x.callback === listener; });
						if (index >= 0) {
							this.listeners[key].splice(index, 1);
						}
					}
					if (!this.listeners[key].length || listener == null) {
						delete this.listeners[key];
					}
				}
				return this;
			},
			configurable: true
		},
		trigger: {
			value: async function (e, arg) {
				const me = this;
				const event = typeof e === 'string' ? new Event(e) : e;
				const results = [];
				const listeners = (me.listeners[event.type] || []).concat(me.listeners[''])
					.filter(x => {
						return x && (x.constraint == null || x.constraint.call(x.scope || me, e, arg));
					})
					.map(x => {
						if (x.once) {
							me.off(event.type, x.callback);
						}
						return () => {
							try {
								const result = x.callback.call(x.scope || me, event, arg || {});
								return Promise.resolve(result)
							} catch (error) {
								console.error('Executing listener failed', { error: error, event: event, listener: x.callback });
								return Promise.resolve(error);
							}
						};
					});

				return listeners
					.reduce((r, f) => {
						return r.then(f).then(result => {
							results.push(result);
							return result;
						});
					}, Promise.resolve())
					.then(() => results);
			},
			configurable: true
		}
	});
};
EventHandler.injectInto(EventHandler.prototype);

export default EventHandler;