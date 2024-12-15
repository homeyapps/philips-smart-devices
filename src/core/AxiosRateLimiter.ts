'use strict';

import { clearInterval } from 'node:timers';
import { InternalAxiosRequestConfig } from 'axios';

export default class AxiosRateLimiter {

	private lastRequestTime: number;
	private timeout: NodeJS.Timeout | null = null;
	private readonly delayBetweenRequests: number;

	constructor(delayBetweenRequests: number) {
	  this.delayBetweenRequests = delayBetweenRequests;
	  this.lastRequestTime = 0;
	}

	async request(config: InternalAxiosRequestConfig<unknown>) {
	  const currentTime = Date.now();
	  const timeSinceLastRequest = currentTime - this.lastRequestTime;
	  const delay = this.delayBetweenRequests - timeSinceLastRequest;

	  if (delay > 0) {
	    await new Promise((resolve) => {
	      this.timeout = setTimeout(resolve, delay);
	    });
	  }

	  this.lastRequestTime = Date.now();
	  return config;
	}

	destroy() {
	  if (this.timeout !== null) {
	    clearInterval(this.timeout);
	    this.timeout = null;
	  }
	}

}
