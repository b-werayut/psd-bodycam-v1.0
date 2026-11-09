import { describe, expect, it } from 'vitest';

import { emptyUserForm, toCreatePayload, toUpdatePayload, validateUserForm } from './userForm';

const valid = {
  ...emptyUserForm(),
  username: 'somchai',
  fullName: 'สมชาย ใจดี',
  roleCode: 'OPERATOR',
  departmentId: '3',
};

describe('validateUserForm', () => {
  it('accepts a complete form', () => {
    expect(validateUserForm(valid)).toEqual({});
  });

  it('requires a username of at most 50 characters', () => {
    expect(validateUserForm({ ...valid, username: '  ' }).username).toBe(
      'users.form.errorUsernameRequired',
    );
    expect(validateUserForm({ ...valid, username: 'a'.repeat(51) }).username).toBe(
      'users.form.errorUsernameLong',
    );
    expect(validateUserForm({ ...valid, username: 'a'.repeat(50) }).username).toBeUndefined();
  });

  it('requires a full name and a role', () => {
    const errors = validateUserForm({ ...valid, fullName: '', roleCode: '' });
    expect(errors.fullName).toBe('users.form.errorFullNameRequired');
    expect(errors.roleCode).toBe('users.form.errorRoleRequired');
  });

  it('requires a department for non-ADMIN roles only', () => {
    expect(validateUserForm({ ...valid, departmentId: '' }).departmentId).toBe(
      'users.form.errorDepartmentRequired',
    );
    expect(validateUserForm({ ...valid, roleCode: 'ADMIN', departmentId: '' })).toEqual({});
  });

  it('checks email format only when given', () => {
    expect(validateUserForm({ ...valid, email: '' }).email).toBeUndefined();
    expect(validateUserForm({ ...valid, email: 'nope' }).email).toBe('users.form.errorEmail');
    expect(validateUserForm({ ...valid, email: 'a@b.co' }).email).toBeUndefined();
  });
});

describe('toCreatePayload', () => {
  it('trims and lowercases the username and omits an empty password', () => {
    const payload = toCreatePayload({ ...valid, username: '  SomChai ', password: '', email: ' ' });
    expect(payload).toEqual({
      username: 'somchai',
      fullName: 'สมชาย ใจดี',
      roleCode: 'OPERATOR',
      departmentId: '3',
    });
  });

  it('keeps a given password and email', () => {
    const payload = toCreatePayload({ ...valid, password: 'secret-pass', email: 'a@b.co' });
    expect(payload.password).toBe('secret-pass');
    expect(payload.email).toBe('a@b.co');
  });
});

describe('toUpdatePayload', () => {
  it('sends only changed fields and clears optional ones with null', () => {
    const original = { ...valid, email: 'a@b.co' };
    expect(toUpdatePayload({ ...original, fullName: 'ใหม่', email: '' }, original)).toEqual({
      fullName: 'ใหม่',
      email: null,
    });
    expect(toUpdatePayload(original, original)).toEqual({});
    expect(toUpdatePayload({ ...original, password: 'new-password' }, original)).toEqual({
      password: 'new-password',
    });
  });
});
