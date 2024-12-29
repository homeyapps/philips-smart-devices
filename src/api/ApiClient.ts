'use strict';

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import https from 'https';
import LocalLogger from '../core/LocalLogger';

export interface ApiClientConfig {
    baseURL: string;
    log: LocalLogger;
    timeout?: number;
    retryCount?: number;
    headers?: Record<string, string>;
    httpsAgent?: https.Agent;
}

export abstract class ApiClient {

    private readonly defaultTimeout = 10000;

    private readonly log: LocalLogger;
    private readonly axiosInstance: AxiosInstance;

    protected constructor(config: ApiClientConfig) {
      this.log = config.log;

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

      this.setupInterceptors();
    }

    protected async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
      try {
        return (await this.axiosInstance.get(url, config)).data;
      } catch (error: unknown) {
        return this.handleError(error);
      }
    }

    protected async put<T, R>(url: string, data: T, config?: AxiosRequestConfig): Promise<R> {
      try {
        return (await this.axiosInstance.put(url, data, config)).data;
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
        (request) => {
          this.log.log(`Outgoing request: [${request.method?.toUpperCase()}] ${request.baseURL}${request.url}`);
          if (request.data) {
            this.log.debug('Request data:', request.data);
          }
          return request;
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
