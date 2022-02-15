class AuthenticationService {
    constructor() {
        console.warn('This is a dummy-service');
    }

    async login(email, password) {
        console.warn('Not implemented: login');
    }
    async refresh(refreshToken) {
        console.warn('Not implemented: refresh');
    }
    async resetPassword(email) {
        console.warn('Not implemented: resetPassword');
    }
}

export default AuthenticationService;