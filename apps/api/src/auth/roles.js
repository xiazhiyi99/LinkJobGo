// Unknown/legacy roles never gain administrative permissions implicitly.
const accountRole = user => user?.role === 'admin' ? 'admin' : 'user';
const accountCapabilities = user => ({ extensionDebug: accountRole(user) === 'admin' });
module.exports = { accountRole, accountCapabilities };
