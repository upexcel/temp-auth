import { Injectable, EventEmitter, Output } from '@angular/core';

import * as auth0 from 'auth0-js';
import { Subscription } from 'rxjs/Subscription';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/timer';
import 'rxjs/add/operator/mergeMap';
import { environment } from 'src/environments/environment';
import { HttpClient } from '@angular/common/http';


@Injectable()
export class AuthService {
  // Create Auth0 web auth instance
  private auth0 = new auth0.WebAuth({
    clientID: environment['clientID'],
    domain: environment['domain'],
    responseType: environment['responseType'],
    redirectUri: environment['redirectUri'],
    scope: environment['scope']
  });
  userProfile: any;
  // Create a stream of logged in status to communicate throughout app
  loggedIn: boolean;
  // Subscribe to token expiration stream
  refreshSub: Subscription;
  @Output() userProfileEvent: EventEmitter<any> = new EventEmitter();
  constructor(
    private http: HttpClient,
  ) {
    const lsProfile = localStorage.getItem('profile');
    if (this.tokenValid) {
      this.userProfile = JSON.parse(lsProfile);
      this.setLoggedIn(true);
      this.scheduleRenewal();
    } else if (!this.tokenValid && lsProfile) {
      this.logout();
    }
  }

  setLoggedIn(value: boolean) {
    // Update login status subject
    this.loggedIn = value;
    
  }

  login(redirect?: string) {
    // Auth0 authorize request
    this.auth0.authorize();
  }

  getUserProfile() {
    return this.userProfile;
  }

  handleAuth() {
    this.auth0.parseHash((err, authResult) => {
      if (authResult && authResult.accessToken && authResult.idToken) {
        window.location.hash = '';
        this._getProfile(authResult);
      } else if (err) {
        console.error(`Error authenticating: ${err.error}`);
      }
    });
  }

  private _getProfile(authResult) {
    // Use access token to retrieve user's profile and set session
    this.auth0.client.userInfo(authResult.accessToken, (err, profile) => {
      if (profile) {
        this._setSession(authResult, profile);
      } else if (err) {
        console.warn(`Error retrieving profile: ${err.error}`);
      }
    });
  }

  private async _setSession(authResult, profile?) {
    const expiresAt = JSON.stringify((authResult.expiresIn * 1000) + Date.now());
    localStorage.setItem('access_token', authResult.accessToken);
    localStorage.setItem('id_token', authResult.idToken);
    localStorage.setItem('expires_at', expiresAt);
    const scopes = authResult.scope || '';
    localStorage.setItem('scopes', JSON.stringify(scopes));
    if (profile) {
      localStorage.setItem('profile', JSON.stringify(profile));
      this.userProfile = profile;
      try {
        const access = this.http.post(`${environment['apibase']}auth0/getToken`, {});
        console.log(access);
        this.setLoggedIn(true);
      } catch (error) {
        throw (error);
      }
    }

    this.scheduleRenewal();
  }

  logout(noRedirect?: boolean) {
    localStorage.clear();
    this.userProfile = undefined;
    this.setLoggedIn(false);
    this.unscheduleRenewal();
    window.location.href = document.documentURI;
  }

  get tokenValid(): boolean {
    // Check if current time is past access token's expiration
    const expiresAt = JSON.parse(localStorage.getItem('expires_at'));
    return Date.now() < expiresAt;
  }

  renewToken() {
    this.auth0.checkSession({},
      (err, authResult) => {
        if (authResult && authResult.accessToken) {
          this._setSession(authResult);
        } else if (err) {
          console.warn(`Could not renew token: ${err.errorDescription}`);
          // Log out without redirecting to clear auth data
          this.logout(true);
          // Log in again
          this.login();
        }
      }
    );
  }

  scheduleRenewal() {
    // If user isn't authenticated, do nothing
    if (!this.tokenValid) { return; }
    // Unsubscribe from previous expiration observable
    this.unscheduleRenewal();
    // Create and subscribe to expiration observable
    const expiresAt = JSON.parse(localStorage.getItem('expires_at'));
    const expiresIn$ = Observable.of(expiresAt)
      .mergeMap(
        expires => {
          const now = Date.now();
          // Use timer to track delay until expiration
          // to run the refresh at the proper time
          return Observable.timer(Math.max(1, expires - now));
        }
      );

    this.refreshSub = expiresIn$
      .subscribe(() => {
        this.renewToken();
        this.scheduleRenewal();
      });
  }

  unscheduleRenewal() {
    if (this.refreshSub) {
      this.refreshSub.unsubscribe();
    }
  }

  userHasScopes(scopes: Array<string>): boolean {
    const grantedScopes = JSON.parse(localStorage.getItem('scopes')).split(' ');
    return scopes.every(scope => grantedScopes.includes(scope));
  }

}
