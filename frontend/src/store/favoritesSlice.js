import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

export const fetchFavorites = createAsyncThunk('favorites/fetchFavorites', async (token) => {
  const res = await fetch('http://localhost:4000/api/favorites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
});

export const addFavorite = createAsyncThunk('favorites/addFavorite', async ({ token, bookId }) => {
  await fetch('http://localhost:4000/api/favorites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ bookId }),
  });
  return bookId;
});

export const clearAllFavorites = createAsyncThunk('favorites/clearAllFavorites', async (token) => {
  const res = await fetch('http://localhost:4000/api/favorites', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('Failed to clear favorites. Please try again.');
});

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState: { items: [], status: 'idle', clearing: false, clearError: null },
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(fetchFavorites.pending, state => { state.status = 'loading'; })
      .addCase(fetchFavorites.fulfilled, (state, action) => {
        state.status = 'succeeded';
        state.items = action.payload;
      })
      .addCase(fetchFavorites.rejected, state => { state.status = 'failed'; })
      .addCase(clearAllFavorites.pending, state => {
        state.clearing = true;
        state.clearError = null;
      })
      .addCase(clearAllFavorites.fulfilled, state => {
        state.clearing = false;
        state.items = [];
      })
      .addCase(clearAllFavorites.rejected, state => {
        state.clearing = false;
        state.clearError = 'Failed to clear favorites. Please try again.';
      })
      .addCase(addFavorite.fulfilled, (state, action) => {
        // After adding, fetch the updated favorites list to ensure UI is in sync
      });
  },
});

export default favoritesSlice.reducer;
