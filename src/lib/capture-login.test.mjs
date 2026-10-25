import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureLogin,validateLoginPlan,redactLoginText} from './capture-login.ts';
import {validProgressId,publicScout} from './scout-access.ts';
const target=new URL('https://site.example.com/account');
const input={mode:'basic',url:'https://site.example.com/login',username:'fictional@example.test',password:'fictional-only-password',consent:true};

test('login requires server-validated consent, same HTTPS origin and bounded credentials',()=>{
 assert.equal(captureLogin(undefined,target),undefined);
 assert.equal(captureLogin(input,target).mode,'basic');
 for(const patch of [{consent:false},{mode:'advanced'},{url:'https://other.example.com/login'},{url:input.url+'?next=elsewhere'},{url:input.url+'#step'},{password:''},{username:'a'.repeat(257)},{password:'b'.repeat(1025)}])assert.throws(()=>captureLogin({...input,...patch},target));
 assert.throws(()=>captureLogin(input,new URL('http://site.example.com/account')));
 assert.throws(()=>captureLogin(input,new URL(target.href+'?secret=x')));
 assert.equal(captureLogin({...input,mode:'advanced',aiConsent:true},target).mode,'advanced');
});

test('AI plans may select only known field IDs in the same form',()=>{
 const fields=[{id:0,form:0,kind:'username'},{id:1,form:0,kind:'password'},{id:2,form:0,kind:'submit'},{id:3,form:1,kind:'submit'}];
 assert.deepEqual(validateLoginPlan({username:0,password:1,submit:2},fields),{username:0,password:1,submit:2});
 for(const plan of [{username:0,password:1,submit:3},{password:0,submit:2},{password:1,submit:2,url:'https://elsewhere.example.com'},{password:1,submit:99},{password:'1',submit:2},{submit:2},null])assert.throws(()=>validateLoginPlan(plan,fields));
});

test('credential redaction removes both secrets including repeated occurrences',()=>{
 const login=captureLogin(input,target),safe=redactLoginText(`${input.username} ${input.password} ${input.password}`,login);
 assert.equal(safe,'[redacted] [redacted] [redacted]');
});

test('progress IDs have a separate strict shape and never become public pack fields',()=>{
 const job='job-12345678-1234-4234-8234-123456789abc';
 assert.equal(validProgressId(job),job);
 for(const value of ['job-arbitrary',job+'/other',job.toUpperCase(),job.replace('job-','scout-'),null])assert.throws(()=>validProgressId(value));
 assert.equal('progressJobId' in publicScout({progressJobId:job,userId:'owner'}),false);
});
