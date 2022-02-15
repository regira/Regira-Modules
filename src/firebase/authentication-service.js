import { login, refresh, resetPassword } from './authentication-utility';


class AuthenticationService {
    constructor(options) {
        this.apiKey = options.apiKey || options;
    }

    async login(email, password) {
        return login(this.apiKey, email, password);
    }
    async refresh(refreshToken) {
        return refresh(this.apiKey, refreshToken);
    }
    async resetPassword(email) {
        return resetPassword(this.apiKey, email);
    }
}


export default AuthenticationService;