set -e

source ~/.tisl/sdks/__SDKVERSION__.env # set by tinit
COMPILER=__COMPILER__ # set by tinit
RTOS=$TIRTOSNAME

# for old SDK versions, we need to make the kernel separately
# and patch $DEST/$NAME/tirtos/ccs/makefile"
[[ ${TISL_SDK##*_} = 5.30.00* ]] && \
  echo "Making kernel ..." && \
  make -C kernel/$RTOS/builds/$BOARDNAME/release/$COMPILER && \
  sed -i -e 's/^KERNEL_BUILD\s*:=/KERNEL_BUILD ?=/' app/$RTOS/$COMPILER/makefile && \
  export KERNEL_BUILD="../../../kernel/$RTOS/builds/$BOARDNAME/release"

make -C app/$RTOS/$COMPILER

OUT=app/$RTOS/$COMPILER/*.out
ls -l $OUT
