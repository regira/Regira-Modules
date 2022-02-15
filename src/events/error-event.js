import Event from './event';

class ErrorEvent extends Event {
	constructor(...args) {
		const type = args.find(function (x) { return typeof (x) === "string"; });
		const src = args.find(function (x) { return x instanceof Event; });
		const data = args.except([type, src])[0];
		super(type || "error", src, data);
	}
}

export default ErrorEvent;