// ============================================================
// S3 兼容存储客户端 (基于 aws4fetch)
// ============================================================

import { AwsClient } from 'aws4fetch';
import type { App } from './types';

let awsClient: AwsClient | null = null;

function getS3Client(env: App['Bindings']): AwsClient {
  if (!awsClient) {
    awsClient = new AwsClient({
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      service: 's3',
      region: env.S3_REGION || 'auto',
    });
  }
  return awsClient;
}

/** 生成 S3 对象键 */
function objectKey(userId: string, type: string): string {
  return `data/${userId}/${type}`;
}

/** 从 S3 读取 JSON 对象 */
export async function getJSON<T>(env: App['Bindings'], userId: string, type: string): Promise<T | null> {
  try {
    const client = getS3Client(env);
    const url = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${objectKey(userId, type)}`;
    const response = await client.fetch(url, { method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) {
      console.error(`S3 GET error: ${response.status}`);
      return null;
    }
    const text = await response.text();
    return JSON.parse(text) as T;
  } catch (err) {
    console.error('S3 getJSON error:', err);
    return null;
  }
}

/** 写入 JSON 对象到 S3 */
export async function putJSON(env: App['Bindings'], userId: string, type: string, data: unknown): Promise<boolean> {
  try {
    const client = getS3Client(env);
    const url = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${objectKey(userId, type)}`;
    const body = JSON.stringify(data);
    const response = await client.fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error(`S3 PUT error: ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('S3 putJSON error:', err);
    return false;
  }
}

/** 从 S3 删除对象 */
export async function deleteObject(env: App['Bindings'], userId: string, type: string): Promise<boolean> {
  try {
    const client = getS3Client(env);
    const url = `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${objectKey(userId, type)}`;
    const response = await client.fetch(url, { method: 'DELETE' });
    return response.ok || response.status === 204;
  } catch (err) {
    console.error('S3 delete error:', err);
    return false;
  }
}

/** 列出用户的所有数据文件 */
export async function listObjects(env: App['Bindings'], prefix: string): Promise<string[]> {
  try {
    const client = getS3Client(env);
    const url = `${env.S3_ENDPOINT}/${env.S3_BUCKET}?prefix=${encodeURIComponent(prefix)}`;
    const response = await client.fetch(url, { method: 'GET' });
    if (!response.ok) return [];
    const xml = await response.text();
    const keys: string[] = [];
    const keyRegex = /<Key>([^<]+)<\/Key>/g;
    let match;
    while ((match = keyRegex.exec(xml)) !== null) {
      keys.push(match[1]);
    }
    return keys;
  } catch (err) {
    console.error('S3 list error:', err);
    return [];
  }
}

/** 健康检查 - 检查 S3 连通性 */
export async function healthCheck(env: App['Bindings']): Promise<boolean> {
  try {
    const client = getS3Client(env);
    const url = `${env.S3_ENDPOINT}/${env.S3_BUCKET}`;
    const response = await client.fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
