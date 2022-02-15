import arrayUtility from '../utilities/array-utility';

const { isArray, isIterable, toArray, newArray, ...arrayFunctions } = arrayUtility;

export default {
	injectInto(target, overwrite = false) {
		Object.getOwnPropertyNames(arrayFunctions)
			.forEach(prop => {
				if (prop !== "constructor" && (overwrite || !target.hasOwnProperty(prop))) {
					Object.defineProperty(target, prop, {
						value: function () {
							const args = [this, ...arguments];
							return arrayFunctions[prop].apply(this, args);
						},
						configurable: true
					});
				}
			});
	},
	use(overwrite = false) {
		this.injectInto(Array.prototype, overwrite);
	}
};