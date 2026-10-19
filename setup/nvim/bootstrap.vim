" Install declarations without loading configuration that requires missing plugins.
set nomore
try
  let s:lines = readfile($DOTFILES_ROOT . '/nvim/init.vim')
  let s:first = index(s:lines, 'call plug#begin()')
  let s:last = index(s:lines, 'call plug#end()')
  if s:first < 0 || s:last <= s:first
    throw 'Cannot find the vim-plug declaration block'
  endif
  execute join(s:lines[s:first : s:last], "\n")
  PlugInstall --sync
  if !empty(filter(getline(1, '$'), 'v:val =~# "^x"'))
    throw 'Plugin installation failed; inspect the vim-plug output'
  endif
  for s:plugin in values(g:plugs)
    if !isdirectory(s:plugin.dir)
      throw 'Missing plugin: ' . s:plugin.dir
    endif
  endfor
catch
  echohl ErrorMsg
  echom v:exception
  echohl None
  cquit 1
endtry
qa!
