describe('Clear all favorites', () => {
  const username = `clear-favorites-${Date.now()}`;
  const password = 'favorites-test-password';
  let token;
  let books;

  before(() => {
    cy.request('POST', 'http://localhost:4000/api/register', { username, password });
    cy.request('POST', 'http://localhost:4000/api/login', { username, password })
      .then(response => { token = response.body.token; });
    cy.request('http://localhost:4000/api/books')
      .then(response => { books = response.body.slice(0, 2); });
  });

  beforeEach(() => {
    cy.then(() => {
      books.forEach(book => {
        cy.request({
          method: 'POST',
          url: 'http://localhost:4000/api/favorites',
          headers: { Authorization: 'Bearer ' + token },
          body: { bookId: book.id },
        });
      });
    });
    cy.visit('http://localhost:5173');
    cy.contains('Login').click();
    cy.intercept('POST', '**/api/login').as('login');
    cy.get('input[name="username"]').type(username);
    cy.get('input[name="password"]').type(password);
    cy.get('button#login').click();
    cy.wait('@login').then(({ response }) => { token = response.body.token; });
    cy.get('a#favorites-link').click();
    cy.contains('li', books[0].title).should('be.visible');
  });

  it('keeps favorites and sends no delete request when confirmation is canceled', () => {
    const deleted = cy.stub().as('deleted');
    cy.intercept('DELETE', '**/api/favorites', deleted);
    cy.on('window:confirm', message => {
      expect(message).to.eq('Are you sure you want to clear all your favorite books?');
      return false;
    });
    cy.contains('button', 'Clear All').click();
    books.forEach(book => cy.contains('li', book.title).should('be.visible'));
    cy.get('@deleted').should('not.have.been.called');
  });

  it('clears all favorites after confirmation and persists the empty state', () => {
    cy.intercept('DELETE', '**/api/favorites', request => {
      expect(request.headers.authorization).to.eq('Bearer ' + token);
      request.continue();
    }).as('clear');
    const confirm = cy.stub().returns(true);
    cy.on('window:confirm', confirm);
    cy.contains('button', 'Clear All').click();
    cy.wait('@clear').its('response.statusCode').should('eq', 200);
    cy.then(() => expect(confirm).to.have.been.calledOnce);
    cy.contains('No favorite books yet.').should('be.visible');
    cy.contains('button', 'Clear All').should('be.disabled');
    cy.reload();
    cy.contains('No favorite books yet.').should('be.visible');
    cy.contains('button', 'Clear All').should('be.disabled');
    cy.contains('Books').click();
    cy.get('[title="In Favorites"]').should('not.exist');
  });

  ['server error', 'network error'].forEach(failure => {
    it(`keeps favorites after a ${failure} and allows retry`, () => {
      cy.intercept('DELETE', '**/api/favorites', failure === 'server error'
        ? { statusCode: 500, body: { message: 'Failed to clear favorites' }, delay: 300 }
        : { forceNetworkError: true }).as('failedClear');
      cy.on('window:confirm', () => true);
      cy.contains('button', 'Clear All').click();
      if (failure === 'server error') {
        cy.contains('button', 'Clearing...').should('be.disabled');
      }
      cy.wait('@failedClear');
      cy.get('[role="alert"]').should('contain', 'Failed to clear favorites. Please try again.');
      books.forEach(book => cy.contains('li', book.title).should('be.visible'));
      cy.contains('button', 'Clear All').should('be.enabled');
      cy.intercept('DELETE', '**/api/favorites', request => request.continue()).as('retry');
      cy.contains('button', 'Clear All').click();
      cy.wait('@retry').its('response.statusCode').should('eq', 200);
      cy.contains('No favorite books yet.').should('be.visible');
      cy.get('[role="alert"]').should('not.exist');
    });
  });
});
