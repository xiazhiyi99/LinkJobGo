import { apiRequest } from '../../lib/api-client';
export const getProfile=()=>apiRequest('/profiles/me');
export const updateProfile=(body:unknown)=>apiRequest('/profiles/me',{method:'PATCH',body:JSON.stringify(body)});
