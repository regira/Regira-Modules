//import axios from 'axios';// need axios for IE compatibility
import axios from 'axios';


class FirebaseError extends Error {
    constructor(message, statusCode) {
        super(`${message} (${statusCode})`);

        this.code = statusCode;
    }
}

// response parser
const checkResponse = response => {
    const statusCode = response.status;
    if (statusCode < 200 || statusCode >= 400) {
        const message = (response.data && response.data.error)
            ? response.data.error.message
            : response.statusText;
        console.error("Firebase Error", statusCode, { message, response });
        throw new FirebaseError(message, statusCode);
    }
};

// axios wrapper
const http = async (url, method, data) => {
    const config = { url, method };
    if (typeof (data) !== 'undefined') {
        config.data = data;
    }
    const response = await axios(config);
    checkResponse(response);
    return response.data;
};

// Firebase communicator
export default {
    get: url => http(url, 'get'),
    put: (url, data) => http(url, 'put', data),
    post: (url, data) => http(url, 'post', data),
    delete: url => http(url, 'delete')
};
