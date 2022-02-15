class Event {
	constructor(type, src, data) {
		this.type = type;
		this.src = src;
		if (data != null) {
			Object.keys(data).forEach((key) => {
				if (!(key in this)) {
					this[key] = data[key];
				}
			});
		}
	}
}

export default Event;