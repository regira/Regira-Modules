import EventHandler from '../events/event-handler';

/**
 * Handles login/logoff and saves state of current identity
 * automatically refreshes token when autoRefresh is enabled
 */
class IdentityManager {
    constructor({ authenticationService, autoRefresh = false }) {
        this._service = authenticationService;
        this._autoRefreshTimer = null;
        this._autoRefresh = autoRefresh;

        this._setState();
    }


    get autoRefresh() {
        return this._autoRefresh;
    }
    set autoRefresh(value) {
        this._autoRefresh = !!value;
        this._checkAutoRefresh();
    }


    async login(email, password) {
        const identityResponse = await this._service.login(email, password);
        this._setState(identityResponse);
        this._checkAutoRefresh();
        return this.trigger('login', { ...this.state });
    }
    async refresh() {
        const identityResponse = await this._service.refresh(this.state.refreshToken);
        this._setState(identityResponse);
        this._checkAutoRefresh();
        return this.trigger('refresh', { ...this.state });
    }
    async logoff() {
        const oldState = { ...this.state };
        this._setState();
        return this.trigger('logoff', oldState);
    }


    _setState(response = null) {
        if (!response) {
            this.state = { isAuthenticated: false };
            return;
        }

        this.state = {
            ...response,
            expiresAt: new Date(new Date().getTime() + response.expiresIn * 1000),
            isAuthenticated: true
        };
    }
    _checkAutoRefresh() {
        const mgr = this;
        if (this._autoRefreshTimer) {
            clearTimeout(this._autoRefreshTimer);
        }
        if (this._autoRefresh) {
            const refreshInMs = Math.abs(this.state.expiresAt - new Date()) - (60 * 1000)//1 minute to spare
            this._autoRefreshTimer = setTimeout(mgr.refresh, refreshInMs);
        }
    }
}
EventHandler.injectInto(IdentityManager.prototype);


export default IdentityManager;