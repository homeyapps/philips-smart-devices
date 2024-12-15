'use strict';

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import axiosRetry, { exponentialDelay } from 'axios-retry';
import https from 'https';
import LocalLogger from '../core/LocalLogger';
import AxiosRateLimiter from '../core/AxiosRateLimiter';

export interface ApiClientConfig {
    baseURL: string;
    log: LocalLogger;
    timeout?: number;
    retryCount?: number;
    headers?: Record<string, string>;
    httpsAgent?: https.Agent;
    rateLimiter?: AxiosRateLimiter;
}

export abstract class ApiClient {

    private readonly defaultTimeout = 10000;
    private readonly defaultRetryCount = 3;

    private readonly log: LocalLogger;
    private readonly axiosInstance: AxiosInstance;

    protected readonly rateLimiter?: AxiosRateLimiter;

    protected constructor(config: ApiClientConfig) {
      this.log = config.log;
      this.rateLimiter = config.rateLimiter;
      this.axiosInstance = axios.create({
        baseURL: config.baseURL,
        timeout: config.timeout ?? this.defaultTimeout,
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          ...config.headers,
        },
        httpsAgent: config.httpsAgent,
      });

      axiosRetry(this.axiosInstance, {
        retries: config.retryCount ?? this.defaultRetryCount,
        retryDelay: exponentialDelay,
        retryCondition: (error) => axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error),
      });

      this.setupInterceptors();
    }

    public cleanResources() {
      if (this.rateLimiter !== null) {
        this.rateLimiter?.destroy();
      }
    }

    protected async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
      try {
        const response: AxiosResponse<T> = await this.axiosInstance.get(url, config);
        return response.data;
      } catch (error: unknown) {
        return this.handleError(error);
      }
    }

    protected async put<T, R>(url: string, data: T, config?: AxiosRequestConfig): Promise<R> {
      try {
        const response: AxiosResponse<R> = await this.axiosInstance.put(url, data, config);
        return response.data;
      } catch (error: unknown) {
        return this.handleError(error);
      }
    }

    private handleError(error: unknown): never {
      if (axios.isAxiosError(error)) {
        this.log.error(`API Error: ${error.message}`, error.response?.data);
        throw new Error(error.response?.data?.message || error.message);
      } else {
        this.log.error('Unexpected Error: ', error);
        throw new Error('An unexpected error occurred');
      }
    }

    private setupInterceptors(): void {
      this.axiosInstance.interceptors.request.use(
        (requestConfig) => {
          this.log.log(`Outgoing request: [${requestConfig.method?.toUpperCase()}] ${requestConfig.baseURL}${requestConfig.url}`);

          if (requestConfig.data) {
            this.log.debug('Request data:', requestConfig.data);
          }
          if (this.rateLimiter !== undefined) {
            return this.rateLimiter.request(requestConfig);
          }

          return requestConfig;
        },
        (error) => {
          this.log.error('Request error: ', error);
          return Promise.reject(error);
        },
      );

      this.axiosInstance.interceptors.response.use(
        (response) => response,
        (error) => {
          this.log.error('Response error:', error);
          return Promise.reject(error);
        },
      );
    }

}
