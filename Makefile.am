include include.mk

ACLOCAL_AMFLAGS = -I m4 ${ACLOCAL_FLAGS}

SUBDIRS = src

zip-file: all
	-rm -fR $(builddir)/_build
	-rm -fR $(builddir)/zip-files
	mkdir $(builddir)/_build; \
	mkdir $(builddir)/zip-files; \
	$(MAKE) install DESTDIR="$(abs_builddir)/_build"; \
	cp -r "$(builddir)/_build$(extensiondir)" "$(builddir)/_build/"; \
	cp -r "$(builddir)/_build$(datadir)/locale" "$(builddir)/_build/$(uuid)"; \
	cp "$(srcdir)/COPYING" -t "$(builddir)/_build/$(uuid)"; \
	(cd "$(builddir)/_build/$(uuid)"; \
		zip -qr "$(abs_builddir)/zip-files/$(uuid).zip" .; \
	);

install-zip: zip-file
	mkdir -p $(localextensiondir) && unzip -o $(abs_builddir)/zip-files/$(uuid).zip -d $(localextensiondir);

uninstall-zip: Makefile
	-rm -fR $(localextensiondir)
