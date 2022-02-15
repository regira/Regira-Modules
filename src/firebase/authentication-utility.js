import communicator from './communicator';


const AUTH_URLS = {
    REFRESH_TOKEN: 'https://securetoken.googleapis.com/v1',
    IDENTITY_TOOLKIT: 'https://identitytoolkit.googleapis.com/v1/accounts:'
};
function getRestUrl(url, key, action) {
    return `${url}/${action}/?key=${key}`;
};


// Sign in with email / password
export async function login(key, email, password) {
    const url = getRestUrl(AUTH_URLS.IDENTITY_TOOLKIT, key, 'accounts:verifyPassword');
    const data = {
        email,
        password,
        returnSecureToken: true
    };
    const {
        idToken,
        refreshToken,
        expiresIn,
        localId: userId
    } = await communicator.post(url, data);
    
    return { idToken, refreshToken, expiresIn, userId };
};
// Exchange a refresh token for an ID token
export async function refresh(key, refreshToken) {
    const url = getRestUrl(AUTH_URLS.REFRESH_TOKEN, key, 'token');
    const data = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    };
    const {
        id_token: idToken,
        refresh_token: newRefreshToken,// use 'newRefreshToken' to prevent name collision with input refreshToken
        expires_in: expiresIn,
        user_id: userId
    } = await communicator.post(url, data);

    return { idToken, refreshToken: newRefreshToken, expiresIn, userId };
};
// Send password reset email
export async function resetPassword(key, email) {
    const url = getRestUrl(AUTH_URLS.IDENTITY_TOOLKIT, key, 'accounts:sendOobCode');
    const data = {
        email,
        requestType: 'PASSWORD_RESET'
    };
    await communicator.post(url, data);

    return true;
};


// utility object
export default {
    login,
    refresh,
    resetPassword
};