import { describe, expect, it } from 'vitest';

import {
  emptyUserForm,
  toCreatePayload,
  toUpdatePayload,
  userFormFromEntra,
  validateUserForm,
} from './userForm';

const valid = {
  ...emptyUserForm(),
  username: 'somchai',
  firstName: 'สมชาย', lastName: 'ใจดี',
  roleCode: 'OPERATOR',
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
    const errors = validateUserForm({ ...valid, firstName: '', lastName: '', roleCode: '' });
    expect(errors.firstName).toBe('users.form.errorFirstNameRequired');
    expect(errors.roleCode).toBe('users.form.errorRoleRequired');
  });

  it('accepts every role with no extra field (single-department system)', () => {
    for (const roleCode of ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER', 'TEAM_LEADER']) {
      expect(validateUserForm({ ...valid, roleCode })).toEqual({});
    }
  });

  it('checks email format only when given', () => {
    expect(validateUserForm({ ...valid, email: '' }).email).toBeUndefined();
    expect(validateUserForm({ ...valid, email: 'nope' }).email).toBe('users.form.errorEmail');
    expect(validateUserForm({ ...valid, email: 'a@b.co' }).email).toBeUndefined();
  });
});

describe('toCreatePayload', () => {
  it('trims an optional phone and sends changes or null when clearing it', () => {
    const values = { ...valid, phone: ' +66 81 234 5678 ' };
    expect(toCreatePayload(values)).toMatchObject({ phone: '+66 81 234 5678' });
    expect(toUpdatePayload({ ...values, phone: '' }, values)).toEqual({ phone: null });
  });
  it('trims and lowercases the username and omits an empty password', () => {
    const payload = toCreatePayload({ ...valid, username: '  SomChai ', password: '', email: ' ' });
    expect(payload).toEqual({
      username: 'somchai',
      firstName: 'สมชาย', lastName: 'ใจดี',
      roleCode: 'OPERATOR',
    });
  });

  it('keeps a given password and email', () => {
    const payload = toCreatePayload({ ...valid, password: 'secret-pass', email: 'a@b.co' });
    expect(payload.password).toBe('secret-pass');
    expect(payload.email).toBe('a@b.co');
  });

  it('sends azureObjectId only when the form has one', () => {
    expect('azureObjectId' in toCreatePayload(valid)).toBe(false);
    expect(toCreatePayload({ ...valid, azureObjectId: 'oid-1' }).azureObjectId).toBe('oid-1');
  });
});

describe('userFormFromEntra', () => {
  const source = { upn: 'Somchai.J@psd.co.th', displayName: 'สมชาย ใจดี', mail: null, oid: 'oid-1' };

  it('prefills the phone from mobilePhone, then a business phone', () => {
    expect(userFormFromEntra({ ...source, mobilePhone: ' 0812345678 ', businessPhones: ['029999999'] }).phone).toBe('0812345678');
    expect(userFormFromEntra({ ...source, mobilePhone: null, businessPhones: [' ', '029999999'] }).phone).toBe('029999999');
  });

  it('uses structured Entra names before the display name', () => {
    expect(userFormFromEntra({ ...source, givenName: ' Mary Jane ', surname: ' Watson ' })).toMatchObject({
      firstName: 'Mary Jane', lastName: 'Watson',
    });
  });

  it('splits an unstructured name once and supports a missing surname', () => {
    expect(userFormFromEntra({ ...source, displayName: '  Mary   van der Berg  ' })).toMatchObject({
      firstName: 'Mary', lastName: 'van der Berg',
    });
    expect(userFormFromEntra({ ...source, displayName: 'ผู้ดูแลระบบ' })).toMatchObject({
      firstName: 'ผู้ดูแลระบบ', lastName: '',
    });
  });

  it('prefills username from the UPN local part, the name, the UPN as email and the oid', () => {
    expect(userFormFromEntra(source)).toEqual({
      ...emptyUserForm(),
      username: 'somchai.j',
      firstName: 'สมชาย', lastName: 'ใจดี',
      email: 'Somchai.J@psd.co.th',
      azureObjectId: 'oid-1',
    });
  });

  it('never guesses a role or sets a password', () => {
    const values = userFormFromEntra(source);
    expect(values.roleCode).toBe('');
    expect(values.password).toBe('');
  });

  it('drops characters the server rejects and leaves a too-short username empty', () => {
    expect(userFormFromEntra({ ...source, upn: 'som chai+x@psd.co.th' }).username).toBe('somchaix');
    expect(userFormFromEntra({ ...source, upn: 'ก@psd.co.th' }).username).toBe('');
    expect(userFormFromEntra({ ...source, upn: 'ab@psd.co.th' }).username).toBe('');
  });

  it('falls back to the UPN local part when Entra has no display name', () => {
    expect(userFormFromEntra({ ...source, displayName: null }).firstName).toBe('Somchai.J');
  });

  it('uses mail when the UPN is not an email address', () => {
    const values = userFormFromEntra({ ...source, upn: 'somchai', mail: 'somchai@psd.co.th' });
    expect(values.email).toBe('somchai@psd.co.th');
  });

  it('has no azureObjectId without an oid', () => {
    expect('azureObjectId' in userFormFromEntra({ ...source, oid: undefined })).toBe(false);
  });

  it('produces a form that passes validation once a role is picked', () => {
    expect(validateUserForm({ ...userFormFromEntra(source), roleCode: 'OPERATOR' })).toEqual({});
  });
});

describe('toUpdatePayload', () => {
  it('normalizes changed usernames and omits case-only changes', () => {
    expect(toUpdatePayload({ ...valid, username: ' New.Name ' }, valid)).toEqual({ username: 'new.name' });
    expect(toUpdatePayload({ ...valid, username: ' SOMCHAI ' }, valid)).toEqual({});
  });
  it('sends only changed fields and clears optional ones with null', () => {
    const original = { ...valid, email: 'a@b.co' };
    expect(toUpdatePayload({ ...original, firstName: 'ใหม่', lastName: '', email: '' }, original)).toEqual({
      firstName: 'ใหม่', lastName: '',
      email: null,
    });
    expect(toUpdatePayload(original, original)).toEqual({});
    expect(toUpdatePayload({ ...original, password: 'new-password' }, original)).toEqual({
      password: 'new-password',
    });
    expect(toUpdatePayload({ ...original, roleCode: 'VIEWER' }, original)).toEqual({
      roleCode: 'VIEWER',
    });
  });
});
